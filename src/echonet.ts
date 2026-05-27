import EchonetLite, {
    EchonetDiscoveryResponse,
    EchonetPropertyResponse,
} from 'node-echonet-lite';
import logger from './logger';

// ─── Device class identifiers ───────────────────────────────────────────────

const DEVICE_CLASSES = {
    DISTRIBUTION_PANEL: { group: 0x02, class: 0x87 },
    SOLAR_POWER: { group: 0x02, class: 0x79 },
    WATER_FLOW_METER: { group: 0x02, class: 0x81 },
    ELECTRIC_WATER_HEATER: { group: 0x02, class: 0x6B },
    HOME_AIR_CONDITIONER: { group: 0x01, class: 0x30 },
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

interface EchonetDevice {
    address: string;
    eoj: number[];
}

export interface EchonetMetric {
    name: string;
    group: string;
    class: string;
    address: string;
    circuit?: number;
    location?: string;
    value: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Reject after `ms` milliseconds with a TimeoutError. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
        promise.then(result => {
            clearTimeout(timer);
            return result;
        }).catch(err => {
            clearTimeout(timer);
            throw err;
        }),
        new Promise<T>((_, reject) =>
            timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms)
        ),
    ]);
}

/** Build a metric object, optionally attaching circuit or location. */
function makeMetric(
    name: string,
    group: string,
    cls: string,
    address: string,
    value: number,
    extra?: { circuit?: number; location?: string },
): EchonetMetric {
    return { name, group, class: cls, address, value, ...extra };
}

// ─── Provider ────────────────────────────────────────────────────────────────

/** Unique key for a device: address + full 3-byte EOJ (group:class:instance). */
function deviceKey(address: string, eoj: number[]): string {
    return `${address}:${eoj[0]}:${eoj[1]}:${eoj[2]}`;
}

export default class ELProvider {
    private echonet: EchonetLite;
    private devices: Map<string, EchonetDevice>;

    private readonly discoveryIntervalMs: number;
    private readonly discoveryDurationMs: number;
    private readonly requestTimeoutMs: number;
    private discoveryTimer: ReturnType<typeof setInterval> | null = null;
    private discovering = false;

    // Request queue to serialize EPC requests over the single UDP socket
    private requestQueue: Promise<void> = Promise.resolve();

    constructor(netif: string, discoveryIntervalSecs: number, discoveryDurationSecs: number, requestTimeoutSecs: number = 5) {
        this.echonet = new EchonetLite({
            type: 'lan',
            netif,
            membership: false,
        });
        this.devices = new Map();
        this.discoveryIntervalMs = discoveryIntervalSecs * 1000;
        this.discoveryDurationMs = discoveryDurationSecs * 1000;
        this.requestTimeoutMs = requestTimeoutSecs * 1000;

        this.echonet.init((err: Error | null) => {
            if (err) {
                this.logError(err);
            } else {
                this.startDiscoveryCycle();
                this.discoveryTimer = setInterval(
                    () => { this.startDiscoveryCycle(); },
                    this.discoveryIntervalMs,
                );
            }
        });
    }

    private startDiscoveryCycle(): void {
        if (this.discovering) {
            logger.warn('Discovery already in progress, skipping');
            return;
        }
        this.discovering = true;
        this.discoverDevices();
        setTimeout(() => {
            this.stopDiscovery();
            this.discovering = false;
        }, this.discoveryDurationMs);
    }

    private discoverDevices(): void {
        logger.info('Starting Echonet Lite discovery');

        this.echonet.startDiscovery((err: Error | null, res: EchonetDiscoveryResponse) => {
            if (err) {
                this.logError(err);
                return;
            }

            const { address, eoj: eojList } = res.device;

            for (const eoj of eojList) {
                const key = deviceKey(address, eoj);
                if (this.devices.has(key)) {
                    continue;
                }

                const groupCode = eoj[0];
                const classCode = eoj[1];
                const groupName = this.echonet.getClassGroupName(groupCode);
                const className = this.echonet.getClassName(groupCode, classCode);

                const eojHex = JSON.stringify(eoj, (_key, value) =>
                    typeof value === 'number' ? '0x' + value.toString(16) : value
                );
                logger.info(`Discovered group: ${groupName}, class: ${className} at address ${address} [${eojHex}]`);

                this.devices.set(key, { address, eoj });
            }
        });
    }

    async getMetrics(): Promise<EchonetMetric[]> {
        const metrics: EchonetMetric[] = [];

        for (const device of this.devices.values()) {
            try {
                const deviceMetrics = await this.collectDeviceMetrics(device);
                metrics.push(...deviceMetrics);
            } catch (err) {
                logger.error(`Error collecting metrics from device ${device.address} [${device.eoj.map(b => '0x' + b.toString(16)).join(':')}]: ${err}`);
            }
        }

        return metrics;
    }

    async collectDeviceMetrics(device: EchonetDevice): Promise<EchonetMetric[]> {
        const metrics: EchonetMetric[] = [];
        const groupCode = device.eoj[0];
        const classCode = device.eoj[1];
        const groupName = this.echonet.getClassGroupName(groupCode);
        const className = this.echonet.getClassName(groupCode, classCode);

        // ── Distribution panel metering class ──────────────────────────────
        // 0xC2 (kWh units) is needed as a multiplier for 0xC0, 0xC1, 0xB3.
        // All EPC reads must be sequential to avoid conflicts with the single UDP socket.
        if (groupCode === DEVICE_CLASSES.DISTRIBUTION_PANEL.group && classCode === DEVICE_CLASSES.DISTRIBUTION_PANEL.class) {
            const powerUnitsKwh = await this.getEpcValue(device.address, device.eoj, 0xC2, false);
            const multiplier = this.kwhMultiplier(powerUnitsKwh ?? 0x00);

            const powerTotalInKwh = await this.getEpcValue(device.address, device.eoj, 0xC0, false);
            if (powerTotalInKwh !== null) {
                metrics.push(makeMetric('power_total_in_kwh', groupName, className, device.address, this.scaleValue(powerTotalInKwh, multiplier)));
            }

            const powerTotalOutKwh = await this.getEpcValue(device.address, device.eoj, 0xC1, false);
            if (powerTotalOutKwh !== null) {
                metrics.push(makeMetric('power_total_out_kwh', groupName, className, device.address, this.scaleValue(powerTotalOutKwh, multiplier)));
            }

            const powerTotalWatts = await this.getEpcValue(device.address, device.eoj, 0xC6, true);
            if (powerTotalWatts !== null) {
                metrics.push(makeMetric('power_total_watts', groupName, className, device.address, powerTotalWatts));
            }

            const powerCircuitKwh = await this.getEpcList(device.address, device.eoj, 0xB3, false);
            powerCircuitKwh.forEach((circuitValue, index) => {
                if (circuitValue === null) return;
                metrics.push(makeMetric('power_circuit_kwh', groupName, className, device.address, this.scaleValue(circuitValue, multiplier), { circuit: index + 1 }));
            });

            const powerCircuitWatts = await this.getEpcList(device.address, device.eoj, 0xB7, true);
            powerCircuitWatts.forEach((value, index) => {
                if (value === null) return;
                metrics.push(makeMetric('power_circuit_watts', groupName, className, device.address, value, { circuit: index + 1 }));
            });
        }

        // ── Home solar power generation class ──────────────────────────────
        if (groupCode === DEVICE_CLASSES.SOLAR_POWER.group && classCode === DEVICE_CLASSES.SOLAR_POWER.class) {
            const solarMultiplier = 0.001; // Wh to kWh

            const generatedWatts = await this.getEpcValue(device.address, device.eoj, 0xE0, false);
            if (generatedWatts !== null) {
                metrics.push(makeMetric('power_generated_watts', groupName, className, device.address, generatedWatts));
            }

            const generatedKwh = await this.getEpcValue(device.address, device.eoj, 0xE1, false);
            if (generatedKwh !== null) {
                metrics.push(makeMetric('power_generated_kwh', groupName, className, device.address, this.scaleValue(generatedKwh, solarMultiplier)));
            }

            const soldKwh = await this.getEpcValue(device.address, device.eoj, 0xE3, false);
            if (soldKwh !== null) {
                metrics.push(makeMetric('power_sold_kwh', groupName, className, device.address, this.scaleValue(soldKwh, solarMultiplier)));
            }
        }

        // ── Water flow meter class ─────────────────────────────────────────
        // 0xE1 (volume units) is needed as a multiplier for 0xE0.
        if (groupCode === DEVICE_CLASSES.WATER_FLOW_METER.group && classCode === DEVICE_CLASSES.WATER_FLOW_METER.class) {
            const waterVolumeUnits = await this.getEpcValue(device.address, device.eoj, 0xE1, false);
            const multiplier = this.waterVolumeMultiplier(waterVolumeUnits ?? 0x00);

            const waterConsumedVolume = await this.getEpcValue(device.address, device.eoj, 0xE0, false);
            if (waterConsumedVolume !== null) {
                const M3_TO_LITRES = 1000;
                metrics.push(makeMetric('water_used_litres', groupName, className, device.address, waterConsumedVolume * multiplier * M3_TO_LITRES));
            }
        }

        // ── Electric water heater class ────────────────────────────────────
        if (groupCode === DEVICE_CLASSES.ELECTRIC_WATER_HEATER.group && classCode === DEVICE_CLASSES.ELECTRIC_WATER_HEATER.class) {
            const waterTemperatureCelsius = await this.getEpcValue(device.address, device.eoj, 0xC1, false);
            if (waterTemperatureCelsius !== null) {
                metrics.push(makeMetric('water_temperature_celsius', groupName, className, device.address, waterTemperatureCelsius));
            }

            const waterCapacityLitres = await this.getEpcValue(device.address, device.eoj, 0xF8, false);
            if (waterCapacityLitres !== null) {
                metrics.push(makeMetric('water_capacity_litres', groupName, className, device.address, waterCapacityLitres));
            }

            const waterAvailableLitres = await this.getEpcValue(device.address, device.eoj, 0xE1, false);
            if (waterAvailableLitres !== null) {
                metrics.push(makeMetric('water_available_litres', groupName, className, device.address, waterAvailableLitres));
            }

            const waterUsedLitres = await this.getEpcValue(device.address, device.eoj, 0xF2, true);
            if (waterUsedLitres !== null) {
                metrics.push(makeMetric('water_used_litres', groupName, className, device.address, waterUsedLitres));
            }
        }

        // ── Home air conditioner class ─────────────────────────────────────
        if (groupCode === DEVICE_CLASSES.HOME_AIR_CONDITIONER.group && classCode === DEVICE_CLASSES.HOME_AIR_CONDITIONER.class) {
            const indoorTemperatureCelsius = await this.getEpcValue(device.address, device.eoj, 0xBB, true);
            if (indoorTemperatureCelsius !== null) {
                metrics.push(makeMetric('air_temperature_celsius', groupName, className, device.address, indoorTemperatureCelsius, { location: 'indoor' }));
            }

            const outdoorTemperatureCelsius = await this.getEpcValue(device.address, device.eoj, 0xBE, true);
            if (outdoorTemperatureCelsius !== null) {
                metrics.push(makeMetric('air_temperature_celsius', groupName, className, device.address, outdoorTemperatureCelsius, { location: 'outdoor' }));
            }

            const indoorRelativeHumidityPercent = await this.getEpcValue(device.address, device.eoj, 0xBA, true);
            if (indoorRelativeHumidityPercent !== null) {
                metrics.push(makeMetric('air_relative_humidity_percent', groupName, className, device.address, indoorRelativeHumidityPercent, { location: 'indoor' }));
            }
        }

        return metrics;
    }

    // Enqueue a request to ensure only one EPC request is in flight at a time
    private enqueue<T>(request: () => Promise<T>): Promise<T> {
        const prev = this.requestQueue;
        const queued = prev.then(request);
        this.requestQueue = queued.then(() => {}, () => {}); // Keep chain alive on error
        return queued;
    }

    getEpcValue(address: string, eoj: number[], epc: number, signed: boolean): Promise<number | null> {
        const label = `[${address}] epc=0x${epc.toString(16)}`;
        return this.enqueue(() => {
            let settled = false;
            const inner = new Promise<number | null>((resolve, reject) => {
                this.echonet.getPropertyValue(address, eoj, epc, (err: Error | null, res: EchonetPropertyResponse) => {
                    if (settled) return;
                    if (err != null) {
                        settled = true;
                        logger.error(`EPC GET error ${label}: ${err}`);
                        reject(err);
                        return;
                    }
                    for (const prop of res.message.prop) {
                        if (prop.epc === epc && prop.buffer !== null) {
                            settled = true;
                            resolve(this.convertValue(Buffer.from(prop.buffer), signed));
                            return;
                        }
                    }
                    settled = true;
                    logger.debug(`EPC GET ${label}: no matching property in response, skipping`);
                    resolve(null);
                });
            });
            return withTimeout(inner, this.requestTimeoutMs, `EPC GET ${label}`);
        });
    }

    setEpcValue(address: string, eoj: number[], epc: number, edt: Buffer): Promise<void> {
        return new Promise((resolve, reject) => {
            logger.debug(`EPC SET: [${address}] eoj=${JSON.stringify(eoj)}, epc=0x${epc.toString(16)}, edt=${edt.toString('hex')}`);
            this.echonet.setPropertyValue(address, eoj, epc, edt, (err: Error | null, _res: EchonetPropertyResponse) => {
                if (err != null) {
                    logger.error(`EPC SET error [${address}] epc=0x${epc.toString(16)}: ${err}`);
                    reject(err);
                    return;
                }
                resolve();
            });
        });
    }

    getEpcList(address: string, eoj: number[], epc: number, signed: boolean): Promise<(number | null)[]> {
        const label = `[${address}] epc=0x${epc.toString(16)}`;
        return this.enqueue(() => {
            let settled = false;
            const inner = new Promise<(number | null)[]>((resolve, reject) => {
                this.echonet.getPropertyValue(address, eoj, epc, (err: Error | null, res: EchonetPropertyResponse) => {
                    if (settled) return;
                    if (err != null) {
                        settled = true;
                        logger.error(`EPC GET LIST error ${label}: ${err}`);
                        reject(err);
                        return;
                    }
                    for (const prop of res.message.prop) {
                        if (prop.epc === epc && prop.buffer !== null) {
                            settled = true;
                            // EDT array format: [first_index (1B), last_index (1B), values...]
                            const buf = Buffer.from(prop.buffer);
                            const aryLen = buf[1] - buf[0] + 1;
                            const valLen = (buf.length - 2) / aryLen;
                            if (!Number.isInteger(valLen) || valLen < 1) {
                                logger.warn(`EPC GET LIST ${label}: malformed array buffer, skipping`);
                                resolve([]);
                                return;
                            }
                            const values: (number | null)[] = [];
                            for (let i = 2; i <= buf.length - valLen; i += valLen) {
                                values.push(this.convertValue(buf.slice(i, i + valLen), signed));
                            }
                            resolve(values);
                            return;
                        }
                    }
                    settled = true;
                    logger.debug(`EPC GET LIST ${label}: no matching property in response, skipping`);
                    resolve([]);
                });
            });
            return withTimeout(inner, this.requestTimeoutMs, `EPC GET LIST ${label}`);
        });
    }

    convertValue(buffer: Buffer, signed: boolean): number | null {
        if (signed) {
            switch (buffer.byteLength) {
                case 1: return buffer.readInt8();
                case 2: return buffer.readInt16BE();
                case 4: return buffer.readInt32BE();
            }
        } else {
            switch (buffer.byteLength) {
                case 1: return buffer.readUint8();
                case 2: return buffer.readUint16BE();
                case 4: return buffer.readUint32BE();
            }
        }

        logger.warn(`convertValue: unexpected buffer length ${buffer.byteLength}, skipping`);
        return null;
    }

    scaleValue(value: number, multiplier: number): number {
        return value * multiplier;
    }

    kwhMultiplier(value: number): number {
        switch (value) {
            case 0x00: return 1;
            case 0x01: return 0.1;
            case 0x02: return 0.01;
            case 0x03: return 0.001;
            case 0x04: return 0.0001;
            case 0x0A: return 10;
            case 0x0B: return 100;
            case 0x0C: return 1000;
            case 0x0D: return 10000;
            default: return 1;
        }
    }

    waterVolumeMultiplier(value: number): number {
        switch (value) {
            case 0x00: return 1;
            case 0x01: return 0.1;
            case 0x02: return 0.01;
            case 0x03: return 0.001;
            case 0x04: return 0.0001;
            case 0x05: return 0.00001;
            case 0x06: return 0.000001;
            default: return 1;
        }
    }

    stopDiscovery(): void {
        logger.info('Stopping Echonet Lite discovery');
        this.echonet.stopDiscovery();
    }

    stopDiscoveryCycles(): void {
        if (this.discoveryTimer !== null) {
            clearInterval(this.discoveryTimer);
            this.discoveryTimer = null;
        }
    }

    shutdown(): Promise<void> {
        logger.info('Shutting down');
        this.stopDiscoveryCycles();
        return new Promise(resolve => {
            this.echonet.close(() => {
                logger.info('Closed');
                resolve();
            });
        });
    }

    private logError(err: Error): void {
        logger.error(err.toString());
    }
}