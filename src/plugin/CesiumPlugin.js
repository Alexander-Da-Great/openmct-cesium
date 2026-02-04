import CesiumViewComponent from '../components/CesiumViewer.vue';
import CesiumService from '../services/CesiumService.js';
import { createApp } from 'vue';

export default function CesiumPlugin() {
    return function install(openmct) {
        // Shared reference to the service instance currently being looked at
        let activeService = null;

        openmct.types.addType('cesium.globe', {
            name: '3D Globe',
            creatable: true,
            cssClass: 'icon-globe',
            initialize: (obj) => { obj.composition = []; }
        });

        openmct.types.addType('satellite', {
            name: 'Satellite',
            description: 'A 3D spacecraft model with instrument sensor cone.',
            creatable: true,
            cssClass: 'icon-target',
            initialize: (obj) => {
                obj.modelUrl = '/Satellite.glb';
                obj.modelScale = 1.0;
                obj.sensorFov = 30;
                obj.sensorRange = 1000000;
                return obj;
            },
            form: [
                { name: '3D Model URL (.glb)', key: 'modelUrl', control: 'textfield', cssClass: 'l-input-lg' },
                { name: 'Model Scale', key: 'modelScale', control: 'numberfield', cssClass: 'l-input-sm' },
                { name: 'Sensor FOV (Degrees)', key: 'sensorFov', control: 'numberfield', cssClass: 'l-input-sm' },
                { name: 'Sensor Range (Meters)', key: 'sensorRange', control: 'numberfield', cssClass: 'l-input-sm' }
            ]
        });

        openmct.actions.register({
            name: 'Jump to Target',
            key: 'cesium.flyto',
            cssClass: 'icon-target',
            appliesTo: (objectPath) => objectPath[0].type === 'satellite',
            invoke: (objectPath) => {
                const id = openmct.objects.makeKeyString(objectPath[0].identifier);
                if (activeService) activeService.flyToEntity(id);
            }
        });

        openmct.actions.register({
            name: 'Follow Target',
            key: 'cesium.follow',
            cssClass: 'icon-eye-open',
            appliesTo: (objectPath) => objectPath[0].type === 'satellite',
            invoke: (objectPath) => {
                const id = openmct.objects.makeKeyString(objectPath[0].identifier);
                if (activeService) activeService.trackEntity(id);
            }
        });

        openmct.actions.register({
            name: 'Reset 3D View',
            key: 'cesium.reset',
            cssClass: 'icon-reset',
            appliesTo: (objectPath) => objectPath[0].type === 'cesium.globe',
            invoke: () => {
                if (activeService) activeService.resetView();
            }
        });

        openmct.objectViews.addProvider({
            key: 'cesium-viewer',
            name: '3D View',
            canView: (domainObject) => domainObject.type === 'cesium.globe',
            view: (domainObject) => {
                let app;
                const instanceService = new CesiumService(); 

                return {
                    show: (element) => {
                        activeService = instanceService; 

                        // Update activeService whenever user interacts with this pane
                        element.addEventListener('mousedown', () => {
                            activeService = instanceService;
                        });

                        app = createApp(CesiumViewComponent, { domainObject });
                        app.provide('openmct', openmct);
                        app.provide('cesiumService', instanceService);
                        app.mount(element);
                    },
                    destroy: () => {
                        if (activeService === instanceService) activeService = null;
                        if (app) app.unmount();
                        instanceService.destroy();
                    }
                };
            },
            priority: () => 100
        });
    };
}