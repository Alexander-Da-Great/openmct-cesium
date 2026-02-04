import CesiumViewComponent from '../components/CesiumViewer.vue';
import { CesiumService } from '../services/CesiumService.js';
import { createApp } from 'vue';
import '../styles/cesium.scss';

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
            cssClass: 'icon-satellite',
            initialize: (obj) => {
                obj.composition = [];
                obj.modelUrl = '/Satellite.glb';
                obj.modelScale = 2.0;
            }
        });

        openmct.types.addType('satellite.sensor', {
            name: 'Satellite Sensor',
            creatable: true,
            cssClass: 'icon-satellite-sensor',
            initialize: (obj) => {
                obj.shape = 'cone';
                obj.fov = 30;
                obj.range = 800000; // This is the "Height" of the cone
                obj.color = '#ffff00';
                obj.direction = '+Z'; // +X, -X, +Y, -Y, +Z, -Z
                obj.offBoresightRotation = 0; // Rotation around the pointing axis
            },
            form: [
                { name: 'Shape', key: 'shape', control: 'select', options: [
                    { name: 'Conical', value: 'cone' },
                    { name: 'Frustum', value: 'frustum' }
                ]},
                { name: 'FOV (Degrees)', key: 'fov', control: 'numberfield' },
                { name: 'Range/Height (Meters)', key: 'range', control: 'numberfield' },
                { name: 'Pointing Direction', key: 'direction', control: 'select', options: [
                    { name: 'Forward (+Z)', value: '+Z' }, { name: 'Backward (-Z)', value: '-Z' },
                    { name: 'Right (+X)', value: '+X' }, { name: 'Left (-X)', value: '-X' },
                    { name: 'Up (+Y)', value: '+Y' }, { name: 'Down (-Y)', value: '-Y' }
                ]},
                { name: 'Local Rotation (Deg)', key: 'offBoresightRotation', control: 'numberfield' },
                { name: 'Color', key: 'color', control: 'textfield' }
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