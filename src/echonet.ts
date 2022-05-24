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
                // if(group_code === 0x02 && (class_code === 0x87 || class_code === 0x79)) {
                    // console.log(`Discovered group: ${groupName}, class: ${className} at address ${address}`);
                    this.devices.push({
                        address: address,
                        eoj: eoj
                    })
                // }
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

                const total = await this.getTotalConsumption(device.address, device.eoj);
                const metric:  EchonetPowerMetric = {
                    name: 'total_power_watts',
                    group: group_name,
                    class: class_name,
                    address: device.address,
                    value: total,
                }
                m.push(metric);

                const circuits = await this.getCircuitConsumption(device.address, device.eoj);
                circuits.forEach((value: number, index: number): void => {
                    if(value === null) {
                        return;
                    }
                    const metric:  EchonetPowerMetric = {
                        name: 'circuit_power_watts',
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

                const generatedWatts = await this.getEnergyGeneratedWatts(device.address, device.eoj);
                metric = {
                    name: 'power_generated_watts',
                    group: group_name,
                    class: class_name,
                    address: device.address,
                    value: generatedWatts,
                }
                m.push(metric);

                const generatedKwh = await this.getEnergyGeneratedKwh(device.address, device.eoj);
                metric = {
                    name: 'power_generated_kwh',
                    group: group_name,
                    class: class_name,
                    address: device.address,
                    value: generatedKwh,
                }
                m.push(metric);

                const soldKwh = await this.getEnergySoldKwh(device.address, device.eoj);
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

    getTotalConsumption(address, eoj): Promise<number> {
        return new Promise(resolve => {
            const epc = 0xC6;
            this.echonet.getPropertyValue(address, eoj, epc, (err, res) => {
                resolve(res['message']['data']['energy']);
            });
        });
    }

    getCircuitConsumption(address, eoj): Promise<number[]> {
        return new Promise(resolve => {
            const epc = 0xB7;
            this.echonet.getPropertyValue(address, eoj, epc, (err, res) => {
                resolve(res['message']['data']['list']);
            });
        });
    }

    getEnergyGeneratedWatts(address, eoj): Promise<number> {
        return new Promise(resolve => {
            const epc = 0xE0;
            this.echonet.getPropertyValue(address, eoj, epc, (err, res) => {
                if(err != null) {
                    console.log(`Error: ${err}`);
                    resolve(0);
                }
                // console.log(`    EnergyGeneratedWatts: ${JSON.stringify(res['message'])}`);
                const prop_list = res['message']['prop'];
                for(var i=0; i<prop_list.length; i++) {
                    var prop = prop_list[i];
                    if(prop['epc'] === epc) {
                        const value = this.bufferToWatts(prop['buffer']);
                        resolve(value);
                    }
                }
                resolve(0);
            });
        });
    }

    getEnergyGeneratedKwh(address, eoj): Promise<number> {
        return new Promise(resolve => {
            const epc = 0xE1;
            this.echonet.getPropertyValue(address, eoj, epc, (err, res) => {
                if(err != null) {
                    console.log(`Error: ${err}`);
                    resolve(0);
                }
                // console.log(`    EnergyGeneratedKwh: ${JSON.stringify(res['message'])}`);
                const prop_list = res['message']['prop'];
                for(var i=0; i<prop_list.length; i++) {
                    var prop = prop_list[i];
                    if(prop['epc'] === epc) {
                        const value = this.bufferToKwh(prop['buffer']);
                        resolve(value);
                    }
                }
                resolve(0);
            });
        });
    }

    getEnergySoldKwh(address, eoj): Promise<number> {
        return new Promise(resolve => {
            const epc = 0xE3;
            this.echonet.getPropertyValue(address, eoj, epc, (err, res) => {
                if(err != null) {
                    console.log(`Error: ${err}`);
                    resolve(0);
                }
                // console.log(`EnergySoldKwh: ${JSON.stringify(res['message'])}`);
                const prop_list = res['message']['prop'];
                for(var i=0; i<prop_list.length; i++) {
                    var prop = prop_list[i];
                    if(prop['epc'] === epc) {
                        const value = this.bufferToKwh(prop['buffer']);
                        resolve(value);
                    }
                }

                resolve(0);
            });
        });
    }

    bufferToWatts(numAry): number {
        if(numAry === null) {
            return 0;
        }
        const buf = Buffer.from(numAry);
        const value = buf.readUint16BE();
        return value;
    }

    bufferToKwh(numAry): number {
        if(numAry === null) {
            return 0;
        }
        const buf = Buffer.from(numAry);
        const value = buf.readUint32BE() / 1000;
        return value;
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