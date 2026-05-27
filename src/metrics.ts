import { Registry, Gauge } from 'prom-client';
import ELProvider from './echonet';
import logger from './logger';

// ─── Meter configuration ──────────────────────────────────────────────────────

export interface MeterConfig {
    name?: string;
    circuits?: Record<string, string>;
}

// ─── Label type aliases ───────────────────────────────────────────────────────

type BaseLabels = 'address' | 'echonet_group' | 'echonet_class';
type MeterLabels = BaseLabels | 'meter_name';
type CircuitLabels = BaseLabels | 'meter_name' | 'circuit_id' | 'circuit_name';
type LocationLabels = BaseLabels | 'meter_name' | 'location';

// ─── Gauge metric names ───────────────────────────────────────────────────────

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
    'air_relative_humidity_percent',
] as const;

type GaugeMetricName = typeof gaugeMetricNames[number];

// ─── Registry factory ─────────────────────────────────────────────────────────

function buildRegistry(): Registry {
    const registry = new Registry();

    registry.registerMetric(new Gauge<MeterLabels>({
        name: 'power_total_in_kwh',
        help: 'Cumulative total incoming power in kWh',
        labelNames: ['address', 'echonet_group', 'echonet_class', 'meter_name'],
    }));

    registry.registerMetric(new Gauge<MeterLabels>({
        name: 'power_total_out_kwh',
        help: 'Cumulative total outgoing power in kWh',
        labelNames: ['address', 'echonet_group', 'echonet_class', 'meter_name'],
    }));

    registry.registerMetric(new Gauge<MeterLabels>({
        name: 'power_total_watts',
        help: 'Total power in watts',
        labelNames: ['address', 'echonet_group', 'echonet_class', 'meter_name'],
    }));

    registry.registerMetric(new Gauge<CircuitLabels>({
        name: 'power_circuit_kwh',
        help: 'Cumulative circuit power in kWh',
        labelNames: ['address', 'echonet_group', 'echonet_class', 'meter_name', 'circuit_id', 'circuit_name'],
    }));

    registry.registerMetric(new Gauge<CircuitLabels>({
        name: 'power_circuit_watts',
        help: 'Circuit power in watts',
        labelNames: ['address', 'echonet_group', 'echonet_class', 'meter_name', 'circuit_id', 'circuit_name'],
    }));

    registry.registerMetric(new Gauge<MeterLabels>({
        name: 'power_generated_watts',
        help: 'Power generated in watts',
        labelNames: ['address', 'echonet_group', 'echonet_class', 'meter_name'],
    }));

    registry.registerMetric(new Gauge<MeterLabels>({
        name: 'power_generated_kwh',
        help: 'Cumulative power generated in kWh',
        labelNames: ['address', 'echonet_group', 'echonet_class', 'meter_name'],
    }));

    registry.registerMetric(new Gauge<MeterLabels>({
        name: 'power_sold_kwh',
        help: 'Cumulative power sold in kWh',
        labelNames: ['address', 'echonet_group', 'echonet_class', 'meter_name'],
    }));

    registry.registerMetric(new Gauge<MeterLabels>({
        name: 'water_capacity_litres',
        help: 'Total water capacity in litres',
        labelNames: ['address', 'echonet_group', 'echonet_class', 'meter_name'],
    }));

    registry.registerMetric(new Gauge<MeterLabels>({
        name: 'water_available_litres',
        help: 'Total water available in litres',
        labelNames: ['address', 'echonet_group', 'echonet_class', 'meter_name'],
    }));

    registry.registerMetric(new Gauge<MeterLabels>({
        name: 'water_temperature_celsius',
        help: 'Water temperature in degrees Celsius',
        labelNames: ['address', 'echonet_group', 'echonet_class', 'meter_name'],
    }));

    registry.registerMetric(new Gauge<MeterLabels>({
        name: 'water_used_litres',
        help: 'Total water used in litres',
        labelNames: ['address', 'echonet_group', 'echonet_class', 'meter_name'],
    }));

    registry.registerMetric(new Gauge<LocationLabels>({
        name: 'air_temperature_celsius',
        help: 'Air temperature in degrees Celsius',
        labelNames: ['address', 'echonet_group', 'echonet_class', 'meter_name', 'location'],
    }));

    registry.registerMetric(new Gauge<LocationLabels>({
        name: 'air_relative_humidity_percent',
        help: 'Air relative humidity in percent',
        labelNames: ['address', 'echonet_group', 'echonet_class', 'meter_name', 'location'],
    }));

    return registry;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export default class MetricsProvider {
    private static _registry: Registry | null = null;

    static get registry(): Registry {
        if (!MetricsProvider._registry) {
            MetricsProvider._registry = buildRegistry();
        }
        return MetricsProvider._registry;
    }

    static readonly gaugeMetrics: Map<GaugeMetricName, Gauge<string>> = new Map(
        gaugeMetricNames.map(name => {
            const gauge = MetricsProvider.registry.getSingleMetric(name) as Gauge<string> | undefined;
            if (!gauge) {
                throw new Error(`Gauge metric not registered: ${name}`);
            }
            return [name, gauge] as [GaugeMetricName, Gauge<string>];
        })
    );

    static echonet: ELProvider;
    private static meters: Record<string, MeterConfig> = {};

    static init(netif: string, discoveryIntervalSecs: number, discoveryDurationSecs: number, epcTimeoutSecs?: number, meters?: Record<string, MeterConfig>): void {
        MetricsProvider.meters = meters ?? {};
        MetricsProvider.echonet = new ELProvider(netif, discoveryIntervalSecs, discoveryDurationSecs, epcTimeoutSecs);
    }

    static async getMetrics(): Promise<string> {
        if (!MetricsProvider.echonet) {
            throw new Error('Metrics not initialized. Call Metrics.init() before getMetrics().');
        }
        const echonetMetrics = await MetricsProvider.echonet.getMetrics();

        for (const metric of echonetMetrics) {
            const gauge = MetricsProvider.gaugeMetrics.get(metric.name as GaugeMetricName);
            if (!gauge) {
                logger.warn(`No gauge registered for metric name: ${metric.name}`);
                continue;
            }

            const meterConfig = MetricsProvider.meters[metric.address];
            const meterName = meterConfig?.name ?? '';
            const baseLabels = {
                address: metric.address,
                echonet_group: metric.group,
                echonet_class: metric.class,
                meter_name: meterName,
            };

            if (metric.circuit !== undefined) {
                const circuitName = meterConfig?.circuits?.[String(metric.circuit)] ?? '';
                gauge.set({ ...baseLabels, circuit_id: metric.circuit, circuit_name: circuitName }, metric.value);
            } else if (metric.location !== undefined) {
                gauge.set({ ...baseLabels, location: metric.location }, metric.value);
            } else {
                gauge.set(baseLabels, metric.value);
            }
        }

        return MetricsProvider.registry.metrics();
    }
}