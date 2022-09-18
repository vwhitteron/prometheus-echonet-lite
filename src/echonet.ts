import MetricsProvider from "./metrics";
import { Buffer } from 'buffer';

var EchonetLite = require('node-echonet-lite');
const { getClassGroupName, getClassName } = require('node-echonet-lite/lib/core/core');

interface EchonetDevice {
    address: string;
    eoj: Array<number>;
}

interface EchonetMetric {
    name: string;
    group: string;
    class: string;
    address: string;
    circuit?: number;
    location?: string;
    value: number;
}

const signed = true; 6
const unsigned = false;

export default class ELProvider {
    echonet: typeof EchonetLite;
    devices: Array<EchonetDevice>;

    constructor() {
        this.echonet = new EchonetLite({
            'type': 'lan',
            'netif': '10.255.1.139',
            'membership': false
        });
        this.devices = new Array<EchonetDevice>();

        this.echonet.init((err) => {
            if(err) {
                this.showErrorExit(err);
            } else { 
                this.discoverDevices();
                setTimeout(() => {this.stopDiscovery()}, 5000);
            }
        });
    }

    discoverDevices() {
        console.log("Starting Echonet Lite discovery");
      
        this.echonet.startDiscovery((err, res) => {
            if(err) {
                this.showErrorExit(err);
            }

            var device = res['device'];

            var address = device['address'];

            for (const eoj of device['eoj']) {
                const group_code = eoj[0];
                const class_code = eoj[1];
                const groupName = this.echonet.getClassGroupName(group_code);
                const className = this.echonet.getClassName(group_code, class_code);

                const eojHex = JSON.stringify(eoj, (key, value) => {
                    if( typeof value === 'number'){
                      return '0x' + value.toString(16)
                    }
                    return value
                });
                console.log(`Discovered group: ${groupName}, class: ${className} at address ${address} [${eojHex}}]`);

                this.devices.push({
                    address: address,
                    eoj: eoj
                })
            }
        });
    }

    async getMetrics(): Promise<EchonetMetric[]> {
        const m: EchonetMetric[] = [];
        
        for await (const device of this.devices) {
            const group_code = device.eoj[0];
            const class_code = device.eoj[1];
            const group_name = this.echonet.getClassGroupName(group_code);
            const class_name = this.echonet.getClassName(group_code, class_code);
            let metric: EchonetMetric;

            // Distribution panel metering class
            if(group_code === 0x02 && class_code === 0x87) {
                // console.log(`Collecting metrics from [${device.address}] - group: ${group_name}, class: ${class_name}`)
                const powerUnitsKwh = await this.getEpcValue(device.address, device.eoj, 0xC2, unsigned);
                const multiplier = this.kwhMultiplier(powerUnitsKwh);

                const powerTotalInKwh = await this.getEpcValue(device.address, device.eoj, 0xC0, unsigned);
                metric = {
                    name: 'power_total_in_kwh',
                    group: group_name,
                    class: class_name,
                    address: device.address,
                    value: this.scaleValue(powerTotalInKwh, multiplier),
                }
                m.push(metric);

                const powerTotalOutKwh = await this.getEpcValue(device.address, device.eoj, 0xC1, unsigned);
                metric = {
                    name: 'power_total_out_kwh',
                    group: group_name,
                    class: class_name,
                    address: device.address,
                    value: this.scaleValue(powerTotalOutKwh, multiplier),
                }
                m.push(metric);

                const powerTotalWatts = await this.getEpcValue(device.address, device.eoj, 0xC6, signed);
                metric = {
                    name: 'power_total_watts',
                    group: group_name,
                    class: class_name,
                    address: device.address,
                    value: powerTotalWatts,
                }
                m.push(metric);

                const powerCircuitKwh = await this.getEpcList(device.address, device.eoj, 0xB3, unsigned);
                powerCircuitKwh.forEach((circuitValue: number, index: number): void => {
                    if(circuitValue === null) {
                        return;
                    }
                    metric = {
                        name: 'power_circuit_kwh',
                        group: group_name,
                        class: class_name,
                        address: device.address,
                        circuit: index + 1,
                        value: this.scaleValue(circuitValue, multiplier),
                    }
                    m.push(metric);
                });

                const powerCircuitWatts = await this.getEpcList(device.address, device.eoj, 0xB7, signed);
                powerCircuitWatts.forEach((value: number, index: number): void => {
                    if(value === null) {
                        return;
                    }
                    metric = {
                        name: 'power_circuit_watts',
                        group: group_name,
                        class: class_name,
                        address: device.address,
                        circuit: index + 1,
                        value: value,
                    }
                    m.push(metric);
                });
            }
            
            // Home solar power generation class
            if(group_code === 0x02 && class_code === 0x79) {
                // console.log(`Collecting metrics from [${device.address}] - group: ${group_name}, class: ${class_name}`)
                const multiplier = 0.001;

                const generatedWatts = await this.getEpcValue(device.address, device.eoj, 0xE0, unsigned);
                metric = {
                    name: 'power_generated_watts',
                    group: group_name,
                    class: class_name,
                    address: device.address,
                    value: generatedWatts,
                }
                m.push(metric);

                const generatedKwh = await this.getEpcValue(device.address, device.eoj, 0xE1, unsigned);
                metric = {
                    name: 'power_generated_kwh',
                    group: group_name,
                    class: class_name,
                    address: device.address,
                    value: this.scaleValue(generatedKwh, multiplier),
                }
                m.push(metric);

                const soldKwh = await this.getEpcValue(device.address, device.eoj, 0xE3, unsigned);
                metric = {
                    name: 'power_sold_kwh',
                    group: group_name,
                    class: class_name,
                    address: device.address,
                    value: this.scaleValue(soldKwh, multiplier),
                }
                m.push(metric);

            }

            // Water flow meter class
            if(group_code === 0x02 && class_code === 0x81) {
                const waterVolumeUnits = await this.getEpcValue(device.address, device.eoj, 0xE1, unsigned);
                const multiplier = this.waterVolumeMultiplier(waterVolumeUnits);

                console.log(`waterVolumeUnits: ${waterVolumeUnits}`);
                console.log(`multiplier: ${multiplier}`);

                const waterConsumedVolume = await this.getEpcValue(device.address, device.eoj, 0xE0, unsigned);
                metric = {
                    name: 'water_used_litres',
                    group: group_name,
                    class: class_name,
                    address: device.address,
                    value: this.scaleValue(waterConsumedVolume, multiplier) * 1000,
                }
                console.log(`metric: ${metric.value}`)
                m.push(metric);
            }

            // Gas meter class
            // if(group_code === 0x02 && class_code === 0x82) {
            //     const gasConsumedVolume = await this.getEpcValue(device.address, device.eoj, 0xE0, 'ulong');
            //     metric = {
            //         name: 'gas_used_cubic_meters',
            //         group: group_name,
            //         class: class_name,
            //         address: device.address,
            //         value: this.multiply(gasConsumedVolume, 0.001),
            //     }
            //     m.push(metric);
            // }
            
            // Electric water heater class
            if(group_code === 0x02 && class_code === 0x6B) {
                const waterTemperatureCelsius = await this.getEpcValue(device.address, device.eoj, 0xC1, unsigned);
                metric = {
                    name: 'water_temperature_celsius',
                    group: group_name,
                    class: class_name,
                    address: device.address,
                    value: waterTemperatureCelsius,
                }
                m.push(metric);

                const waterCapacityLitres = await this.getEpcValue(device.address, device.eoj, 0xF8, unsigned);
                metric = {
                    name: 'water_capacity_litres',
                    group: group_name,
                    class: class_name,
                    address: device.address,
                    value: waterCapacityLitres,
                }
                m.push(metric);

                const waterAvailableLitres = await this.getEpcValue(device.address, device.eoj, 0xE1, unsigned);
                metric = {
                    name: 'water_available_litres',
                    group: group_name,
                    class: class_name,
                    address: device.address,
                    value: waterAvailableLitres,
                }
                m.push(metric);

                const waterUsedLitres = await this.getEpcValue(device.address, device.eoj, 0xF2, signed);
                metric = {
                    name: 'water_used_litres',
                    group: group_name,
                    class: class_name,
                    address: device.address,
                    value: waterUsedLitres,
                }
                m.push(metric);

            }

            // Home air conditioner class
            if(group_code === 0x01 && class_code === 0x30) {
                const indoorTemperatureCelsius = await this.getEpcValue(device.address, device.eoj, 0xBB, true);
                metric = {
                    name: 'air_temperature_celsius',
                    group: group_name,
                    class: class_name,
                    address: device.address,
                    location: 'indoor',
                    value: indoorTemperatureCelsius,
                }
                m.push(metric);

                const outdoorTemperatureCelsius = await this.getEpcValue(device.address, device.eoj, 0xBE, true);
                metric = {
                    name: 'air_temperature_celsius',
                    group: group_name,
                    class: class_name,
                    address: device.address,
                    location: 'outdoor',
                    value: outdoorTemperatureCelsius,
                }
                m.push(metric);
            }            
        }
    
        return m;
    }

    getEpcValue(address: string, eoj: number[], epc: number, signed: boolean): Promise<number> {
        return new Promise(resolve => {
            this.echonet.getPropertyValue(address, eoj, epc, (err, res) => {
                // console.log(`  [${address}] - ${'0x' + epc.toString(16)} - ${JSON.stringify(res['message'])}`)
                if(err != null) {
                    console.log(`Error: ${err}`);
                    resolve(0);
                }
                for(const prop of res['message']['prop']) {
                    if(prop['epc'] === epc && prop['buffer'] !== null) {
                        const buf = Buffer.from(prop['buffer']);
                        resolve(this.convertValue(buf, signed));
                    }
                }
                resolve(0);
            });
        });
    }

    getEpcList(address: string, eoj: number[], epc: number, signed: boolean): Promise<number[]> {
        return new Promise(resolve => {
            this.echonet.getPropertyValue(address, eoj, epc, (err, res) => {
                // console.log(`  [${address}] - ${'0x' + epc.toString(16)} - ${JSON.stringify(res['message'])}`)
                if(err != null) {
                    console.log(`Error: ${err}`);
                    resolve([]);
                }
                for(const prop of res['message']['prop']) {
                    if(prop['epc'] === epc && prop['buffer'] !== null) {
                        const buf = Buffer.from(prop['buffer']);

                        const aryLen = buf[1] - buf[0] + 1;
                        const valLen = (buf.length - 2) / aryLen;

                        const values: number[] = [];
                        for(let i=2; i<=(prop['buffer'].length-valLen); i+=valLen) {
                            values.push(this.convertValue(buf.slice(i, i+valLen), signed));
                        }
                        resolve(values);
                    }
                }
                resolve([]);
            });
        });
    }

    convertValue(buffer: Buffer, signed: boolean): number {
        const buf = Buffer.from(buffer);
        let value: number;

        if(signed) {
            switch(buf.byteLength) {
                case 1: { return buf.readInt8() }
                case 2: { return buf.readInt16BE() }
                case 4: { return buf.readInt32BE() }
            }
        } else {
            switch(buf.byteLength) {
                case 1: { return buf.readUint8() }
                case 2: { return buf.readUint16BE() }
                case 4: { return buf.readUint32BE() }
            }    
        }

        return 0
    }

    scaleValue(value: number, multiplier: number): number {
        let newValue: number;
        if (multiplier < 1) {
            newValue = value / (1 / multiplier);
        } else {
            newValue = value / multiplier;
        }
        return newValue;
    }

    kwhMultiplier(value: number): number {
        switch(value) {
            case 0x00: { return 1 }
            case 0x01: { return 0.1 }
            case 0x02: { return 0.01 }
            case 0x03: { return 0.001 }
            case 0x04: { return 0.0001 }
            case 0x0A: { return 10 }
            case 0x0B: { return 100 }
            case 0x0C: { return 1000 }
            case 0x0D: { return 10000 }
        }
    
        return 1;
    }

    waterVolumeMultiplier(value: number): number {
        switch(value) {
            case 0x00: { return 1 }
            case 0x01: { return 0.1 }
            case 0x02: { return 0.01 }
            case 0x03: { return 0.001 }
            case 0x04: { return 0.0001 }
            case 0x05: { return 0.00001 }
            case 0x06: { return 0.000001 }
        }
    
        return 1;
    }

    stopDiscovery() {
        console.log("Stopping Echonet Lite discovery");
        this.echonet.stopDiscovery();
    }

    async shutdown() {
        console.log("Shutting down");
        this.echonet.close(() => {
          console.log('Closed');
        });
        setTimeout(() => {process.exit();}, 1000);
    }

    showErrorExit(err) {
        console.log('[ERROR] '+ err.toString());
        process.exit();
    }
}