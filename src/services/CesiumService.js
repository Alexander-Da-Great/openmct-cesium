import * as Cesium from 'cesium';

class CesiumService {
    constructor() {
        this.viewer = null;
        this.entitiesMap = new Map();
        this.stopTick = () => {};
        this.stopBounds = () => {};
    }

    init(container, openmct) {
        if (this.viewer) return;

        this.viewer = new Cesium.Viewer(container, {
            animation: false,
            timeline: false,
            requestRenderMode: true,
            sceneModePicker: true,
            baseLayerPicker: true,
            navigationHelpButton: false,
            infoBox: false,
            creditContainer: document.createElement("div")
        });

        this.stopTick = openmct.time.on('tick', (timestamp) => {
            if (this.viewer) {
                this.viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(timestamp));
                this.viewer.scene.requestRender();
            }
        });

        this.stopBounds = openmct.time.on('bounds', (bounds) => {
            if (this.viewer) {
                this.viewer.clock.startTime = Cesium.JulianDate.fromDate(new Date(bounds.start));
                this.viewer.clock.stopTime = Cesium.JulianDate.fromDate(new Date(bounds.end));
            }
        });
    }

    // Follow Logic (Persistent Lock)
    trackEntity(id) {
        if (!this.viewer) return;
        const entity = this.viewer.entities.getById(id);
        if (entity) {
            this.viewer.trackedEntity = entity;
            this.viewer.scene.requestRender();
        }
    }

    // Jump Logic (One-time flight)
    flyToEntity(id) {
        if (!this.viewer) return;
        
        // CRITICAL FIX: Unlock the camera before jumping
        this.viewer.trackedEntity = undefined; 
        
        const entity = this.viewer.entities.getById(id);
        if (entity) {
            this.viewer.flyTo(entity, {
                offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), 1500000),
                duration: 2.0
            });
        }
    }

    async addSatellite(child, openmct) {
        const id = openmct.objects.makeKeyString(child.identifier);
        const bounds = openmct.time.getBounds();
        const history = await openmct.telemetry.request(child, bounds);
        
        if (!history || history.length === 0) return;

        const positionProperty = new Cesium.SampledPositionProperty();
        positionProperty.setInterpolationOptions({
            interpolationDegree: 2,
            interpolationAlgorithm: Cesium.HermitePolynomialApproximation
        });

        history.forEach(p => {
            const time = Cesium.JulianDate.fromDate(new Date(p.utc));
            const pos = Cesium.Cartesian3.fromDegrees(p['position.longitude'], p['position.latitude'], p['position.altitude']);
            positionProperty.addSample(time, pos);
        });

        this.viewer.entities.add({
            id: id,
            name: child.name,
            position: positionProperty,
            // Default POV when tracked
            viewFrom: new Cesium.Cartesian3(-10000.0, -10000.0, 5000.0), 
            point: { pixelSize: 10, color: Cesium.Color.CYAN, outlineWidth: 2 },
            label: {
                text: child.name,
                font: '12pt monospace',
                pixelOffset: new Cesium.Cartesian2(0, -25),
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                outlineWidth: 2,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM
            },
            path: {
                resolution: 1,
                material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.1, color: Cesium.Color.CYAN }),
                width: 3
            }
        });

        this.entitiesMap.set(id, positionProperty);
        this.viewer.scene.requestRender();
    }

    updateSatellite(id, datum) {
        const property = this.entitiesMap.get(id);
        if (property) {
            const time = Cesium.JulianDate.fromDate(new Date(datum.utc));
            const pos = Cesium.Cartesian3.fromDegrees(datum['position.longitude'], datum['position.latitude'], datum['position.altitude']);
            property.addSample(time, pos);
            if (this.viewer) this.viewer.scene.requestRender();
        }
    }

    removeSatellite(id) {
        if (this.viewer) this.viewer.entities.removeById(id);
        this.entitiesMap.delete(id);
    }

    destroy() {
        if (typeof this.stopTick === 'function') this.stopTick();
        if (typeof this.stopBounds === 'function') this.stopBounds();
        if (this.viewer) {
            this.viewer.destroy();
            this.viewer = null;
        }
        this.entitiesMap.clear();
    }
}

export default new CesiumService();