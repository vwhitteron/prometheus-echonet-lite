import MetricsProvider from "./metrics";
import { Buffer } from 'buffer';

var EchonetLite = require('node-echonet-lite');
const { getClassGroupName, getClassName } = require('node-echonet-lite/lib/core/core');

interface EchonetDevice {
    address: string;
    eoj: Array<number>;
}

interface EchonetPowerMetric {
    name: string;
    group: string;
    class: string;
    address: string;
    circuit?: number;
    value: number;
}

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

                console.log(`Discovered group: ${groupName}, class: ${className} at address ${address} [${JSON.stringify(eoj)}]`);

                this.devices.push({
                    address: address,
                    eoj: eoj
                })
            }
        });
    }

    async getMetrics(): Promise<EchonetPowerMetric[]> {
        const m: EchonetPowerMetric[] = [];
        
        for await (const device of this.devices) {
            const group_code = device.eoj[0];
            const class_code = device.eoj[1];
            const group_name = this.echonet.getClassGroupName(group_code);
            const class_name = this.echonet.getClassName(group_code, class_code);

            if(group_code === 0x02 && class_code === 0x87) {
                // console.log(`Collecting metrics from [${device.address}] - group: ${group_name}, class: ${class_name}`)

                let metric: EchonetPowerMetric;

                const powerUnitsKwh = await this.getEpcValueChar(device.address, device.eoj, 0xC2);
                const multiplier = this.kwhMultiplier(powerUnitsKwh);
                // console.log(`  Units: ${powerUnitsKwh} = x${multiplier}`);

            
                const powerTotalInKw = await this.getEpcValueKwh(device.address, device.eoj, 0xC0, multiplier);
                metric = {
                    name: 'power_total_in_kwh',
                    group: group_name,
                    class: class_name,
                    address: device.address,
                    value: powerTotalInKw,
                }
                m.push(metric);

                const powerTotalOutKw = await this.getEpcValueKwh(device.address, device.eoj, 0xC1, multiplier);
                metric = {
                    name: 'power_total_out_kwh',
                    group: group_name,
                    class: class_name,
                    address: device.address,
                    value: powerTotalOutKw,
                }
                m.push(metric);

                const powerTotalWatts = await this.getEpcValueWatts(device.address, device.eoj, 0xC6);
                metric = {
                    name: 'power_total_watts',
                    group: group_name,
                    class: class_name,
                    address: device.address,
                    value: powerTotalWatts,
                }
                m.push(metric);

                const powerCircuitKwh = await this.getEpcListKwh(device.address, device.eoj, 0xB3, multiplier);
                powerCircuitKwh.forEach((value: number, index: number): void => {
                    if(value === null) {
                        return;
                    }
                    metric = {
                        name: 'power_circuit_kwh',
                        group: group_name,
                        class: class_name,
                        address: device.address,
                        circuit: index + 1,
                        value: value,
                    }
                    m.push(metric);
                });

                const powerCircuitWatts = await this.getEpcListWatts(device.address, device.eoj, 0xB7);
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
            
            if(group_code === 0x02 && class_code === 0x79) {
                // console.log(`Collecting metrics from [${device.address}] - group: ${group_name}, class: ${class_name}`)
                let metric:  EchonetPowerMetric;
                const multiplier = 0.001;

                const generatedWatts = await this.getEpcValueWatts(device.address, device.eoj, 0xE0);
                metric = {
                    name: 'power_generated_watts',
                    group: group_name,
                    class: class_name,
                    address: device.address,
                    value: generatedWatts,
                }
                m.push(metric);

                const generatedKwh = await this.getEpcValueKwh(device.address, device.eoj, 0xE1, multiplier);
                metric = {
                    name: 'power_generated_kwh',
                    group: group_name,
                    class: class_name,
                    address: device.address,
                    value: generatedKwh,
                }
                m.push(metric);

                const soldKwh = await this.getEpcValueKwh(device.address, device.eoj, 0xE3, multiplier);
                metric = {
                    name: 'power_sold_kwh',
                    group: group_name,
                    class: class_name,
                    address: device.address,
                    value: soldKwh,
                }
                m.push(metric);

            }
        }
    
        return m;
    }

    getEpcValueChar(address, eoj, epc): Promise<number> {
        return new Promise(resolve => {
            this.echonet.getPropertyValue(address, eoj, epc, (err, res) => {
                // console.log(`  ${JSON.stringify(res['message'])}`)
                if(err != null) {
                    console.log(`Error: ${err}`);
                    resolve(0);
                }
                for(const prop of res['message']['prop']) {
                    if(prop['epc'] === epc && prop['buffer'] !== null) {
                        const buf = Buffer.from(prop['buffer']);
                        const value = buf.readUint8();
                        resolve(value);
                    }
                }
                resolve(0);
            });
        });
    }

    getEpcValueKwh(address, eoj, epc, multiplier): Promise<number> {
        return new Promise(resolve => {
            this.echonet.getPropertyValue(address, eoj, epc, (err, res) => {
                // console.log(`  ${JSON.stringify(res['message'])}`)
                if(err != null) {
                    console.log(`Error: ${err}`);
                    resolve(0);
                }
                for(const prop of res['message']['prop']) {
                    if(prop['epc'] === epc && prop['buffer'] !== null) {
                        const buf = Buffer.from(prop['buffer']);
                        let value: number;
                        if (multiplier < 1) {
                            value = buf.readUint32BE() / (1 / multiplier);
                        } else {
                            value = buf.readUint32BE() * multiplier;
                        }
                        resolve(value);
                    }
                }
                resolve(0);
            });
        });
    }

    getEpcValueWatts(address, eoj, epc): Promise<number> {
        return new Promise(resolve => {
            this.echonet.getPropertyValue(address, eoj, epc, (err, res) => {
                // console.log(`  ${JSON.stringify(res['message'])}`)
                if(err != null) {
                    console.log(`Error: ${err}`);
                    resolve(0);
                }
                for(const prop of res['message']['prop']) {
                    if(prop['epc'] === epc && prop['buffer'] !== null) {
                        const buf = Buffer.from(prop['buffer']);
                        const value = buf.readUint16BE();                
                        resolve(value);
                    }
                }
                resolve(0);
            });
        });
    }

    getEpcListKwh(address, eoj, epc, multiplier): Promise<number[]> {
        return new Promise(resolve => {
            this.echonet.getPropertyValue(address, eoj, epc, (err, res) => {
                // console.log(`  ${JSON.stringify(res['message'])}`)
                if(err != null) {
                    console.log(`Error: ${err}`);
                    resolve([]);
                }
                for(const prop of res['message']['prop']) {
                    if(prop['epc'] === epc && prop['buffer'] !== null) {
                        const buf = Buffer.from(prop['buffer']);
                        const values: number[] = [];
                        for(let i=2; i<=(prop['buffer'].length-4); i+=4) {
                            if (multiplier < 1) {
                                values.push(buf.readUint32BE() / (1 / multiplier));
                            } else {
                                values.push(buf.readUint32BE() * multiplier);
                            }
                        }
                        resolve(values);
                    }
                }
                resolve([]);
            });
        });
    }

    getEpcListWatts(address, eoj, epc): Promise<number[]> {
        return new Promise(resolve => {
            this.echonet.getPropertyValue(address, eoj, epc, (err, res) => {
                // console.log(`  ${JSON.stringify(res['message'])}`)
                if(err != null) {
                    console.log(`Error: ${err}`);
                    resolve([]);
                }
                for(const prop of res['message']['prop']) {
                    if(prop['epc'] === epc && prop['buffer'] !== null) {
                        const buf = Buffer.from(prop['buffer']);
                        const values: number[] = [];
                        for(let i=2; i<=(prop['buffer'].length-2); i+=2) {
                            values.push(buf.readUint16BE(i))
                        }
                        resolve(values);
                    }
                }
                resolve([]);
            });
        });
    }

    kwhMultiplier(value): number {
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