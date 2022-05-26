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
            name:  'power_total_in_kwh',
            help: 'Cumulative total incoming power in kwh',
            labelNames: ['address', 'echonet_group', 'echonet_class', 'meter_name'],
        }) );

        registry.registerMetric( new Gauge({
            name:  'power_total_out_kwh',
            help: 'Cumulative total outgoing power in kwh',
            labelNames: ['address', 'echonet_group', 'echonet_class', 'meter_name'],
        }) );

        registry.registerMetric( new Gauge({
            name:  'power_total_watts',
            help: 'total power in watts',
            labelNames: ['address', 'echonet_group', 'echonet_class', 'meter_name'],
        }) );

        registry.registerMetric( new Gauge({
            name:  'power_circuit_kwh',
            help: 'cumulative circuit power in kwh',
            labelNames: ['address', 'echonet_group', 'echonet_class', 'circuit_id', 'circuit_name'],
        }) );

        registry.registerMetric( new Gauge({
            name:  'power_circuit_watts',
            help: 'circuit power in watts',
            labelNames: ['address', 'echonet_group', 'echonet_class', 'circuit_id', 'circuit_name'],
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

        registry.registerMetric( new Gauge({
            name:  'water_capacity_litres',
            help: 'total water capacity in litres',
            labelNames: ['address', 'echonet_group', 'echonet_class', 'meter_name'],
        }) );

        registry.registerMetric( new Gauge({
            name:  'water_available_litres',
            help: 'total water available in litres',
            labelNames: ['address', 'echonet_group', 'echonet_class', 'meter_name'],
        }) );

        registry.registerMetric( new Gauge({
            name:  'water_temperature_celsius',
            help: 'water temperature in degrees celsius',
            labelNames: ['address', 'echonet_group', 'echonet_class', 'meter_name'],
        }) );

        registry.registerMetric( new Gauge({
            name:  'water_used_litres',
            help: 'total water used in litres',
            labelNames: ['address', 'echonet_group', 'echonet_class', 'meter_name'],
        }) );

        registry.registerMetric( new Gauge({
            name:  'gas_used_cubic_meters',
            help: 'total water used in litres',
            labelNames: ['address', 'echonet_group', 'echonet_class', 'meter_name'],
        }) );

        registry.registerMetric( new Gauge({
            name:  'air_temperature_celsius',
            help: 'air temperature in degrees celsius',
            labelNames: ['address', 'echonet_group', 'echonet_class', 'location'],
        }) );

        return registry
    })

    static registry: Registry = MetricsProvider.initRegistry()

    static echonet = new ELProvider(); 

    public static getMetrics = async () => {
        const registry = MetricsProvider.registry

        const metrics = await this.echonet.getMetrics();

        const gaugeMetricNames = [
            'power_total_in_kwh',
            'power_total_out_kwh',
            'power_total_watts',
            'power_circuit_kwh',
            'power_circuit_watts',
            'power_generated_kwh',
            'power_generated_watts',
            'power_sold_kwh',
            'water_capacity_litres',
            'water_available_litres',
            'water_used_litres',
            'water_temperature_celsius',
            'air_temperature_celsius',
            'gas_used_cubic_meters'
        ]

        let registryMetric = {};
        for(const name of gaugeMetricNames) {
            registryMetric[name] = registry.getSingleMetric(name) as Gauge<any>;
        }
        
        for (const metric of metrics) {
            if(metric.circuit) {
                registryMetric[metric.name].set(
                    {
                        address: metric.address,
                        echonet_group: metric.group,
                        echonet_class: metric.class,
                        circuit_id: metric.circuit
                    },
                    metric.value,
                );
                } else if(metric.location) {
                registryMetric[metric.name].set(
                    {
                        address: metric.address,
                        echonet_group: metric.group,
                        echonet_class: metric.class,
                        location: metric.location
                    },
                    metric.value,
                );
            } else {
                registryMetric[metric.name].set(
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