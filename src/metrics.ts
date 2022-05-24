import { Registry, Gauge, collectDefaultMetrics, register, Counter } from 'prom-client';
import ELProvider from './echonet';
import _ from 'lodash';

export default class MetricsProvider {
    private static initRegistry = _.once(() => {
        if (MetricsProvider.registry != null) {
            return MetricsProvider.registry;
        }

        const registry = new Registry()

        registry.registerMetric( new Gauge({
            name:  'circuit_power_watts',
            help: 'circuit power in watts',
            labelNames: ['address', 'echonet_group', 'echonet_class', 'circuit_id', 'circuit_name'],
        }) );

        registry.registerMetric( new Gauge({
            name:  'total_power_watts',
            help: 'total power in watts',
            labelNames: ['address', 'echonet_group', 'echonet_class', 'meter_name'],
        }) );

        registry.registerMetric( new Gauge({
            name:  'power_generated_watts',
            help: 'power generated in Watts',
            labelNames: ['address', 'echonet_group', 'echonet_class', 'meter_name'],
        }) );

        registry.registerMetric( new Gauge({
            name:  'power_generated_kwh',
            help: 'cumulative power generated in kWh',
            labelNames: ['address', 'echonet_group', 'echonet_class', 'meter_name'],
        }) );

        registry.registerMetric( new Gauge({
            name:  'power_sold_kwh',
            help: 'cumulative power sold in kWh',
            labelNames: ['address', 'echonet_group', 'echonet_class', 'meter_name'],
        }) );

        return registry
    })

    static registry: Registry = MetricsProvider.initRegistry()

    static echonet = new ELProvider(); 

    public static getMetrics = async () => {
        const registry = MetricsProvider.registry

        const metrics = await this.echonet.getMetrics();

        const tpw = registry.getSingleMetric('total_power_watts') as Gauge<any>;
        const cpw = registry.getSingleMetric('circuit_power_watts') as Gauge<any>;
        const pgw = registry.getSingleMetric('power_generated_watts') as Gauge<any>;
        const pgk = registry.getSingleMetric('power_generated_kwh') as Gauge<any>;
        const psk = registry.getSingleMetric('power_sold_kwh') as Gauge<any>;

        for (const metric of metrics) {
            switch(metric.name) {
                case 'circuit_power_watts':
                    cpw.set(
                        {
                            address: metric.address,
                            echonet_group: metric.group,
                            echonet_class: metric.class,
                            circuit_id: metric.circuit
                        },
                        metric.value,
                    );
                    break;
                case 'total_power_watts':
                    tpw.set(
                        {
                            address: metric.address,
                            echonet_group: metric.group,
                            echonet_class: metric.class,
                        },
                        metric.value,
                    );
                    break;
                case 'power_generated_watts':
                    pgw.set(
                        {
                            address: metric.address,
                            echonet_group: metric.group,
                            echonet_class: metric.class,
                        },
                        metric.value,
                    );
                    break;
                case 'power_generated_kwh':
                    pgk.set(
                        {
                            address: metric.address,
                            echonet_group: metric.group,
                            echonet_class: metric.class,
                        },
                        metric.value,
                    );
                    break;
                case 'power_generated_kwh':
                    psk.set(
                        {
                            address: metric.address,
                            echonet_group: metric.group,
                            echonet_class: metric.class,
                        },
                        metric.value,
                    );
                    break;    
            }
        }

        return registry.metrics();
    }
}