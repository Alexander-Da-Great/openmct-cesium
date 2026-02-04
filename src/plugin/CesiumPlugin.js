import CesiumViewComponent from '../components/CesiumViewer.vue';
import { CesiumService } from '../services/CesiumService.js';
import { createApp } from 'vue';

export default function CesiumPlugin() {
    return function install(openmct) {
        let activeService = null;

        openmct.types.addType('cesium.globe', {
            name: '3D Globe',
            creatable: true,
            cssClass: 'icon-globe',
            initialize: (obj) => { obj.composition = []; }
        });
        
        openmct.types.addType('satellite', {
            name: 'Satellite',
            creatable: true,
            cssClass: 'icon-target',
            initialize: (obj) => {
                obj.composition = [];
                obj.modelUrl = '/Satellite.glb';
                obj.modelScale = 2.0;
            }
        });

        openmct.types.addType('satellite.sensor', {
            name: 'Instrument Sensor',
            description: 'A configurable 3D sensor cone for a spacecraft.',
            creatable: true,
            cssClass: 'icon-target',
            initialize: (obj) => {
                obj.sensorFov = 30;
                obj.sensorRange = 1000000;
                obj.sensorColor = '#ffff00'; // Yellow default
                obj.axis = 'Z'; // Which way does it point?
            },
            form: [
                { name: 'FOV (Degrees)', key: 'sensorFov', control: 'numberfield', cssClass: 'l-input-sm' },
                { name: 'Range (Meters)', key: 'sensorRange', control: 'numberfield', cssClass: 'l-input-sm' },
                { name: 'Color (Hex)', key: 'sensorColor', control: 'textfield', cssClass: 'l-input-sm' },
                { 
                    name: 'Pointing Axis', 
                    key: 'axis', 
                    control: 'select', 
                    options: [
                        { name: 'Forward (+Z)', value: 'Z' },
                        { name: 'Right (+X)', value: 'X' },
                        { name: 'Up (+Y)', value: 'Y' }
                    ] 
                }
            ]
        });
        
        openmct.composition.addPolicy((parent, child) => {
            if (parent.type === 'cesium.globe') {
                return child.type === 'satellite';
            }
            if (parent.type === 'satellite') {
                return child.type === 'satellite.sensor';
            }
            return true;
        });
        
        // ACTIONS
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

        // VIEW PROVIDER
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
                        
                        // Captures focus so tree actions know which globe to command
                        element.addEventListener('mouseenter', () => {
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