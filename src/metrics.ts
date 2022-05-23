import { Registry, Gauge, collectDefaultMetrics, register } from 'prom-client';
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
            labelNames: ['address', 'echonet_group', 'echonet_class', 'circuit_id'],
        }) );

        registry.registerMetric( new Gauge({
            name:  'total_power_watts',
            help: 'total power in watts',
            labelNames: ['address', 'echonet_group', 'echonet_class'],
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

        for (const metric of metrics) {
            if(metric.circuit) {
                cpw.set(
                    {
                        address: metric.address,
                        echonet_group: metric.group,
                        echonet_class: metric.class,
                        circuit_id: metric.circuit
                    },
                    metric.value,
                );
            } else {
                tpw.set(
                    {
                        address: metric.address,
                        echonet_group: metric.group,
                        echonet_class: metric.class,
                    },
                    metric.value,
                );                
            }
        }

        return registry.metrics();
    }
}