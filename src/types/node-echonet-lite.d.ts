declare module 'node-echonet-lite' {
    export interface EchonetLiteOptions {
        type: 'lan' | 'wisun' | 'wifibee';
        netif?: string;
        membership?: boolean;
    }

    export interface EchonetProp {
        epc: number;
        buffer: number[] | null;
    }

    export interface EchonetMessage {
        prop: EchonetProp[];
    }

    export interface EchonetResponseDevice {
        address: string;
        eoj: Array<number[]>;
    }

    export interface EchonetDiscoveryResponse {
        device: EchonetResponseDevice;
    }

    export interface EchonetPropertyResponse {
        message: EchonetMessage;
    }

    type EchonetCallback = (err: Error | null) => void;
    type EchonetDiscoveryCallback = (err: Error | null, res: EchonetDiscoveryResponse) => void;
    type EchonetPropertyCallback = (err: Error | null, res: EchonetPropertyResponse) => void;

    class EchonetLite {
        constructor(options: EchonetLiteOptions);

        init(callback: EchonetCallback): void;
        startDiscovery(callback: EchonetDiscoveryCallback): void;
        stopDiscovery(): void;
        close(callback: EchonetCallback): void;

        getClassGroupName(groupCode: number): string;
        getClassName(groupCode: number, classCode: number): string;

        getPropertyValue(
            address: string,
            eoj: number[],
            epc: number,
            callback: EchonetPropertyCallback
        ): void;

        setPropertyValue(
            address: string,
            eoj: number[],
            epc: number,
            edt: Buffer | object,
            callback: EchonetPropertyCallback
        ): void;
    }

    export default EchonetLite;
}

declare module 'node-echonet-lite/lib/core/core' {
    export function getClassGroupName(groupCode: number): string;
    export function getClassName(groupCode: number, classCode: number): string;
}
