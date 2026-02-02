import CesiumViewComponent from '../components/CesiumViewer.vue';
import CesiumService from '../services/CesiumService.js';
import { createApp } from 'vue';

export default function CesiumPlugin() {
    return function install(openmct) {
        // 1. Globe Container
        openmct.types.addType('cesium.globe', {
            name: '3D Globe',
            creatable: true,
            cssClass: 'icon-globe',
            initialize: (obj) => { obj.composition = []; }
        });

        // 2. Satellite with Configurable Sensor properties
        openmct.types.addType('satellite', {
            name: 'Satellite',
            description: 'A 3D spacecraft model with instrument sensor cone.',
            creatable: true,
            cssClass: 'icon-target',
            initialize: (obj) => {
                obj.modelUrl = '/Satellite.glb';
                obj.modelScale = 1.0;
                obj.sensorFov = 30;     // Default degrees
                obj.sensorRange = 1000000; // Default 1000km
                return obj;
            },
            form: [
                { name: '3D Model URL (.glb)', key: 'modelUrl', control: 'textfield', cssClass: 'l-input-lg' },
                { name: 'Model Scale', key: 'modelScale', control: 'numberfield', cssClass: 'l-input-sm' },
                { name: 'Sensor FOV (Degrees)', key: 'sensorFov', control: 'numberfield', cssClass: 'l-input-sm' },
                { name: 'Sensor Range (Meters)', key: 'sensorRange', control: 'numberfield', cssClass: 'l-input-sm' }
            ],
            telemetry: {
                values: [
                    { key: 'utc', name: 'Time', format: 'utc', hints: { domain: 1 } },
                    { key: 'position.latitude', name: 'Lat', format: 'float', units: 'deg', hints: { range: 1 } },
                    { key: 'position.longitude', name: 'Lon', format: 'float', units: 'deg', hints: { range: 2 } },
                    { key: 'position.altitude', name: 'Alt', format: 'float', units: 'm', hints: { range: 3 } },
                    { key: 'attitude.roll', name: 'Roll', format: 'float', units: 'deg' },
                    { key: 'attitude.pitch', name: 'Pitch', format: 'float', units: 'deg' },
                    { key: 'attitude.heading', name: 'Heading', format: 'float', units: 'deg' }
                ]
            }
        });

        // 3. Actions
        openmct.actions.register({
            name: 'Jump to Target',
            key: 'cesium.flyto',
            cssClass: 'icon-target',
            appliesTo: (objectPath) => objectPath[0].type === 'satellite',
            invoke: (objectPath) => {
                const id = openmct.objects.makeKeyString(objectPath[0].identifier);
                CesiumService.flyToEntity(id);
            }
        });

        openmct.actions.register({
            name: 'Follow Target',
            key: 'cesium.follow',
            cssClass: 'icon-eye-open',
            appliesTo: (objectPath) => objectPath[0].type === 'satellite',
            invoke: (objectPath) => {
                const id = openmct.objects.makeKeyString(objectPath[0].identifier);
                CesiumService.trackEntity(id);
            }
        });

        openmct.actions.register({
            name: 'Reset 3D View',
            key: 'cesium.reset',
            cssClass: 'icon-reset',
            appliesTo: (objectPath) => objectPath[0].type === 'cesium.globe',
            invoke: () => CesiumService.resetView()
        });

        // 4. View Provider
        openmct.objectViews.addProvider({
            key: 'cesium-viewer',
            name: '3D View',
            canView: (domainObject) => domainObject.type === 'cesium.globe',
            view: (domainObject) => {
                let app;
                return {
                    show: (element) => {
                        app = createApp(CesiumViewComponent, { domainObject });
                        app.provide('openmct', openmct);
                        app.mount(element);
                    },
                    destroy: () => { if (app) app.unmount(); }
                };
            },
            priority: () => 100
        });
    };
}