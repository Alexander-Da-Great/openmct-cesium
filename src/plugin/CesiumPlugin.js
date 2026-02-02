import CesiumViewComponent from '../components/CesiumViewer.vue';
import CesiumService from '../services/CesiumService.js';
import { createApp } from 'vue';

export default function CesiumPlugin() {
    return function install(openmct) {
        // 1. Types
        openmct.types.addType('cesium.globe', {
            name: '3D Globe',
            creatable: true,
            cssClass: 'icon-globe',
            initialize: (obj) => { obj.composition = []; }
        });

        openmct.types.addType('satellite', {
            name: 'Satellite',
            creatable: true,
            cssClass: 'icon-target'
        });

        // 2. Action: Jump (Releases lock)
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

        // 3. Action: Follow (Locks camera)
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