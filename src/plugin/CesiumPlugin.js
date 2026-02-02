import CesiumViewerComponent from '../components/CesiumViewer.vue';
import { createApp } from 'vue';

export default function CesiumPlugin() {
    return function install(openmct) {
        // 1. Register the Globe Container Type
        openmct.types.addType('cesium.globe', {
            name: '3D Globe',
            description: 'A 3D visualization container. Drop satellites here.',
            creatable: true,
            cssClass: 'icon-globe',
            initialize: (obj) => { obj.composition = []; }
        });

        // 2. Register the Satellite Type (Telemetry Definition)
        openmct.types.addType('satellite', {
            name: 'Satellite',
            description: 'Spacecraft with geodetic telemetry.',
            creatable: true,
            cssClass: 'icon-target',
            telemetry: {
                values: [
                    { key: 'utc', name: 'Time', format: 'utc', hints: { domain: 1 } },
                    { key: 'position.latitude', name: 'Lat', units: 'deg', hints: { range: 1 } },
                    { key: 'position.longitude', name: 'Lon', units: 'deg', hints: { range: 2 } },
                    { key: 'position.altitude', name: 'Alt', units: 'm', hints: { range: 3 } }
                ]
            }
        });

        // 3. Register the View Provider
        openmct.objectViews.addProvider({
            key: 'cesium-viewer',
            name: '3D View',
            canView: (domainObject) => domainObject.type === 'cesium.globe',
            view: (domainObject) => {
                let app;
                return {
                    show: (element) => {
                        app = createApp(CesiumViewerComponent, { domainObject });
                        app.provide('openmct', openmct);
                        app.mount(element);
                    },
                    destroy: () => app.unmount()
                };
            },
            priority: () => 100
        });
    };
}