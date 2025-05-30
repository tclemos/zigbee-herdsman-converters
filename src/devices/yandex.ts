import type {Models as ZHModels} from "zigbee-herdsman";

import {Zcl} from "zigbee-herdsman";

import {access as ea} from "../lib/exposes";
import {logger} from "../lib/logger";
import * as m from "../lib/modernExtend";
import type {Configure, DefinitionWithExtend, ModernExtend, OnEvent, Tz} from "../lib/types";
import {getFromLookup, isString} from "../lib/utils";

const NS = "zhc:yandex";
const manufacturerCode = 0x140a;

interface EnumLookupWithSetCommandArgs extends m.EnumLookupArgs {
    setCommand: string;
}

function enumLookupWithSetCommand(args: EnumLookupWithSetCommandArgs): ModernExtend {
    const {name, lookup, cluster, attribute, zigbeeCommandOptions, setCommand} = args;
    const attributeKey = isString(attribute) ? attribute : attribute.ID;
    const access = ea[args.access ?? "ALL"];

    const mExtend = m.enumLookup(args);

    const toZigbee: Tz.Converter[] = [
        {
            key: [name],
            convertSet:
                access & ea.SET
                    ? async (entity, key, value, meta) => {
                          const payloadValue = getFromLookup(value, lookup);
                          await m.determineEndpoint(entity, meta, cluster).command(cluster, setCommand, {value: payloadValue}, zigbeeCommandOptions);
                          await m.determineEndpoint(entity, meta, cluster).read(cluster, [attributeKey], zigbeeCommandOptions);
                          return {state: {[key]: value}};
                      }
                    : undefined,
            convertGet:
                access & ea.GET
                    ? async (entity, key, meta) => {
                          await m.determineEndpoint(entity, meta, cluster).read(cluster, [attributeKey], zigbeeCommandOptions);
                      }
                    : undefined,
        },
    ];

    return {...mExtend, toZigbee};
}

interface BinaryWithSetCommandArgs extends m.BinaryArgs {
    setCommand: string;
}

function binaryWithSetCommand(args: BinaryWithSetCommandArgs): ModernExtend {
    const {name, valueOn, valueOff, cluster, attribute, zigbeeCommandOptions, setCommand} = args;
    const attributeKey = isString(attribute) ? attribute : attribute.ID;
    const access = ea[args.access ?? "ALL"];

    const mExtend = m.binary(args);

    const toZigbee: Tz.Converter[] = [
        {
            key: [name],
            convertSet:
                access & ea.SET
                    ? async (entity, key, value, meta) => {
                          const payloadValue = value === valueOn[0] ? valueOn[1] : valueOff[1];
                          await m.determineEndpoint(entity, meta, cluster).command(cluster, setCommand, {value: payloadValue}, zigbeeCommandOptions);
                          await m.determineEndpoint(entity, meta, cluster).read(cluster, [attributeKey], zigbeeCommandOptions);
                          return {state: {[key]: value}};
                      }
                    : undefined,
            convertGet:
                access & ea.GET
                    ? async (entity, key, meta) => {
                          await m.determineEndpoint(entity, meta, cluster).read(cluster, [attributeKey], zigbeeCommandOptions);
                      }
                    : undefined,
        },
    ];

    return {...mExtend, toZigbee};
}

function YandexCluster(): ModernExtend {
    return m.deviceAddCustomCluster("manuSpecificYandex", {
        ID: 0xfc03,
        manufacturerCode,
        attributes: {
            switchMode: {ID: 0x0001, type: Zcl.DataType.ENUM8},
            switchType: {ID: 0x0002, type: Zcl.DataType.ENUM8},
            powerType: {ID: 0x0003, type: Zcl.DataType.ENUM8},
            ledIndicator: {ID: 0x0005, type: Zcl.DataType.BOOLEAN},
            interlock: {ID: 0x0007, type: Zcl.DataType.BOOLEAN},
            buttonMode: {ID: 0x0008, type: Zcl.DataType.ENUM8},
        },
        commands: {
            switchMode: {
                ID: 0x01,
                parameters: [{name: "value", type: Zcl.DataType.UINT8}],
            },
            switchType: {
                ID: 0x02,
                parameters: [{name: "value", type: Zcl.DataType.UINT8}],
            },
            powerType: {
                ID: 0x03,
                parameters: [{name: "value", type: Zcl.DataType.UINT8}],
            },
            ledIndicator: {
                ID: 0x05,
                parameters: [{name: "value", type: Zcl.DataType.BOOLEAN}],
            },
            interlock: {
                ID: 0x07,
                parameters: [{name: "value", type: Zcl.DataType.UINT8}],
            },
            buttonMode: {
                ID: 0x08,
                parameters: [{name: "value", type: Zcl.DataType.UINT8}],
            },
        },
        commandsResponse: {},
    });
}

function reinterview(): ModernExtend {
    let coordEnd: ZHModels.Endpoint | number = 1;
    const configure: Configure[] = [
        (device, coordinatorEndpoint, definition) => {
            coordEnd = coordinatorEndpoint;
        },
    ];
    const onEvent: OnEvent[] = [
        async (type, data, device, settings, state, meta) => {
            if (type === "deviceAnnounce") {
                // reinterview
                try {
                    await device.interview(true);
                    logger.info(`Successfully interviewed '${device.ieeeAddr}'`, NS);
                    // bind extended endpoint to coordinator
                    for (const endpoint of device.endpoints) {
                        if (endpoint.supportsOutputCluster("genOnOff")) {
                            await endpoint.bind("genOnOff", coordEnd);
                        }
                    }
                    // send updates to clients
                    if (meta) meta.deviceExposesChanged();
                } catch (error) {
                    logger.error(`Reinterview failed for '${device.ieeeAddr} with error '${error}'`, NS);
                }
            }
        },
    ];

    return {onEvent, configure, isModernExtend: true};
}

export const definitions: DefinitionWithExtend[] = [
    {
        zigbeeModel: ["YNDX-00537"],
        model: "YNDX_00537",
        vendor: "Yandex",
        description: "Single relay",
        extend: [
            reinterview(),
            YandexCluster(),
            m.deviceEndpoints({
                endpoints: {"1": 1, "": 2},
            }),
            m.onOff({
                endpointNames: ["1"],
            }),
            enumLookupWithSetCommand({
                name: "power_type",
                cluster: "manuSpecificYandex",
                attribute: "powerType",
                setCommand: "powerType",
                zigbeeCommandOptions: {manufacturerCode},
                description: "Power supply type",
                lookup: {
                    full: 0x03,
                    low: 0x02,
                    medium: 0x01,
                    high: 0x00,
                },
                entityCategory: "config",
            }),
            enumLookupWithSetCommand({
                name: "switch_type",
                cluster: "manuSpecificYandex",
                attribute: "switchType",
                setCommand: "switchType",
                zigbeeCommandOptions: {manufacturerCode},
                endpointName: "1",
                description: "External switch type 1",
                lookup: {
                    rocker: 0x00,
                    button: 0x01,
                    decoupled: 0x02,
                },
                entityCategory: "config",
            }),
            m.commandsOnOff({endpointNames: [""]}),
        ],
    },
    {
        zigbeeModel: ["YNDX-00538"],
        model: "YNDX_00538",
        vendor: "Yandex",
        description: "Double relay",
        extend: [
            reinterview(),
            YandexCluster(),
            m.deviceEndpoints({
                endpoints: {"1": 1, "2": 2, b1: 3, b2: 4},
            }),
            m.onOff({
                endpointNames: ["1", "2"],
            }),
            enumLookupWithSetCommand({
                name: "power_type",
                cluster: "manuSpecificYandex",
                attribute: "powerType",
                setCommand: "powerType",
                zigbeeCommandOptions: {manufacturerCode},
                description: "Power supply type",
                lookup: {
                    full: 0x03,
                    low: 0x02,
                    medium: 0x01,
                    high: 0x00,
                },
                entityCategory: "config",
            }),
            binaryWithSetCommand({
                name: "interlock",
                cluster: "manuSpecificYandex",
                attribute: "interlock",
                valueOn: ["ON", 1],
                valueOff: ["OFF", 0],
                setCommand: "interlock",
                zigbeeCommandOptions: {manufacturerCode},
                description: "Interlock",
                entityCategory: "config",
            }),
            enumLookupWithSetCommand({
                name: "switch_type",
                cluster: "manuSpecificYandex",
                attribute: "switchType",
                setCommand: "switchType",
                zigbeeCommandOptions: {manufacturerCode},
                endpointName: "1",
                description: "External switch type 1",
                lookup: {
                    rocker: 0x00,
                    button: 0x01,
                    decoupled: 0x02,
                },
                entityCategory: "config",
            }),
            enumLookupWithSetCommand({
                name: "switch_type",
                cluster: "manuSpecificYandex",
                attribute: "switchType",
                setCommand: "switchType",
                zigbeeCommandOptions: {manufacturerCode},
                endpointName: "2",
                description: "External switch type 2",
                lookup: {
                    rocker: 0x00,
                    button: 0x01,
                    decoupled: 0x02,
                },
                entityCategory: "config",
            }),
            m.commandsOnOff({endpointNames: ["b1", "b2"]}),
        ],
    },
    {
        zigbeeModel: ["YNDX-00534"],
        model: "YNDX_00534",
        vendor: "Yandex",
        description: "Single gang wireless switch",
        extend: [
            YandexCluster(),
            m.deviceEndpoints({
                endpoints: {down: 1, up: 2},
            }),
            m.commandsOnOff({endpointNames: ["up", "down"]}),
            m.battery(),
        ],
    },
    {
        zigbeeModel: ["YNDX-00535"],
        model: "YNDX_00535",
        vendor: "Yandex",
        description: "Double gang wireless switch",
        extend: [
            YandexCluster(),
            m.deviceEndpoints({
                endpoints: {b1_down: 1, b2_down: 2, b1_up: 3, b2_up: 4},
            }),
            m.commandsOnOff({endpointNames: ["b1_up", "b1_down", "b2_up", "b2_down"]}),
            m.battery(),
        ],
    },
    {
        zigbeeModel: ["YNDX-00531"],
        model: "YNDX_00531",
        vendor: "Yandex",
        description: "Single gang switch",
        extend: [
            reinterview(),
            YandexCluster(),
            m.deviceEndpoints({
                endpoints: {"1": 1, down: 2, up: 3},
            }),
            m.onOff({
                endpointNames: ["1"],
            }),
            enumLookupWithSetCommand({
                name: "power_type",
                cluster: "manuSpecificYandex",
                attribute: "powerType",
                setCommand: "powerType",
                zigbeeCommandOptions: {manufacturerCode},
                description: "Power supply type",
                lookup: {
                    full: 0x03,
                    low: 0x02,
                    medium: 0x01,
                    high: 0x00,
                },
                entityCategory: "config",
            }),
            m.commandsOnOff({endpointNames: ["up", "down"]}),
            enumLookupWithSetCommand({
                name: "operation_mode",
                cluster: "manuSpecificYandex",
                attribute: "switchMode",
                setCommand: "switchMode",
                zigbeeCommandOptions: {manufacturerCode},
                description: "Switch mode (control_relay - the button control the relay, decoupled - button send events when pressed)",
                lookup: {
                    control_relay: 0x00,
                    up_decoupled: 0x01,
                    decoupled: 0x02,
                    down_decoupled: 0x03,
                },
                entityCategory: "config",
                endpointName: "1",
            }),
            binaryWithSetCommand({
                name: "led_indicator",
                cluster: "manuSpecificYandex",
                attribute: "ledIndicator",
                valueOn: ["ON", 1],
                valueOff: ["OFF", 0],
                setCommand: "ledIndicator",
                zigbeeCommandOptions: {manufacturerCode},
                description: "Led indicator",
                entityCategory: "config",
            }),
        ],
    },
    {
        zigbeeModel: ["YNDX-00532"],
        model: "YNDX_00532",
        vendor: "Yandex",
        description: "Double gang switch",
        extend: [
            reinterview(),
            YandexCluster(),
            m.deviceEndpoints({
                endpoints: {"1": 1, "2": 2, b1_down: 3, b2_down: 4, b1_up: 5, b2_up: 6},
            }),
            m.onOff({
                endpointNames: ["1", "2"],
            }),
            enumLookupWithSetCommand({
                name: "power_type",
                cluster: "manuSpecificYandex",
                attribute: "powerType",
                setCommand: "powerType",
                zigbeeCommandOptions: {manufacturerCode},
                description: "Power supply type",
                lookup: {
                    full: 0x03,
                    low: 0x02,
                    medium: 0x01,
                    high: 0x00,
                },
                entityCategory: "config",
            }),
            m.commandsOnOff({endpointNames: ["b1_up", "b1_down", "b2_up", "b2_down"]}),
            enumLookupWithSetCommand({
                name: "operation_mode",
                cluster: "manuSpecificYandex",
                attribute: "switchMode",
                setCommand: "switchMode",
                zigbeeCommandOptions: {manufacturerCode},
                description: "Switch mode (control_relay - the button control the relay, decoupled - button send events when pressed)",
                lookup: {
                    control_relay: 0x00,
                    up_decoupled: 0x01,
                    decoupled: 0x02,
                    down_decoupled: 0x03,
                },
                entityCategory: "config",
                endpointName: "1",
            }),
            enumLookupWithSetCommand({
                name: "operation_mode",
                cluster: "manuSpecificYandex",
                attribute: "switchMode",
                setCommand: "switchMode",
                zigbeeCommandOptions: {manufacturerCode},
                description: "Switch mode (control_relay - the buttons control the relay, decoupled - buttons send events when pressed)",
                lookup: {
                    control_relay: 0x00,
                    up_decoupled: 0x01,
                    decoupled: 0x02,
                    down_decoupled: 0x03,
                },
                entityCategory: "config",
                endpointName: "2",
            }),
            binaryWithSetCommand({
                name: "led_indicator",
                cluster: "manuSpecificYandex",
                attribute: "ledIndicator",
                valueOn: ["ON", 1],
                valueOff: ["OFF", 0],
                setCommand: "ledIndicator",
                zigbeeCommandOptions: {manufacturerCode},
                description: "Led indicator",
                entityCategory: "config",
            }),
        ],
    },
    {
        zigbeeModel: ["YNDX-00530"],
        model: "YNDX_00530",
        vendor: "Yandex",
        description: "Dimmer",
        extend: [
            YandexCluster(),
            m.light({
                effect: true,
                powerOnBehavior: true,
                configureReporting: true,
                levelReportingConfig: {min: "MIN", max: "MAX", change: 1},
            }),
            m.lightingBallast(),
            binaryWithSetCommand({
                name: "led_indicator",
                cluster: "manuSpecificYandex",
                attribute: "ledIndicator",
                valueOn: ["ON", 1],
                valueOff: ["OFF", 0],
                setCommand: "ledIndicator",
                zigbeeCommandOptions: {manufacturerCode},
                description: "Led indicator",
                entityCategory: "config",
            }),
            enumLookupWithSetCommand({
                name: "button_mode",
                cluster: "manuSpecificYandex",
                attribute: "buttonMode",
                setCommand: "buttonMode",
                zigbeeCommandOptions: {manufacturerCode},
                description: "Dimmer button mode",
                lookup: {
                    general: 0x00,
                    alternative: 0x01,
                },
                entityCategory: "config",
            }),
        ],
    },
];
