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
            requestRenderMode: false, // Must be false for 60fps smoothness
            sceneModePicker: true,
            baseLayerPicker: true,
            navigationHelpButton: false,
            infoBox: false,
            creditContainer: document.createElement("div")
        });

        // SMOOTHNESS CONFIG: 
        // Let Cesium's clock advance based on the system time, 
        // rather than snapping purely to Open MCT ticks.
        this.viewer.clock.clockStep = Cesium.ClockStep.SYSTEM_CLOCK_MULTIPLIER;
        this.viewer.clock.multiplier = 1.0;
        this.viewer.clock.shouldAnimate = true;

        // Synchronize initial time from Open MCT
        const startTimestamp = openmct.time.getBounds().start;
        this.viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(startTimestamp));

        // When Open MCT bounds change (scrubbing), snap the Cesium clock
        this.stopBounds = openmct.time.on('bounds', (bounds) => {
            if (this.viewer) {
                this.viewer.clock.startTime = Cesium.JulianDate.fromDate(new Date(bounds.start));
                this.viewer.clock.stopTime = Cesium.JulianDate.fromDate(new Date(bounds.end));
                // Only snap current time if we aren't in "real-time" mode to allow scrubbing
                if (!openmct.time.isRealTime()) {
                    this.viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(openmct.time.getBounds().end));
                }
            }
        });
    }

    resetView() {
        if (!this.viewer) return;
        this.viewer.trackedEntity = undefined;
        this.viewer.camera.cancelFlight();
        this.viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(0.0, 0.0, 20000000.0),
            duration: 2.0
        });
    }

    trackEntity(id) {
        if (!this.viewer) return;
        const entity = this.viewer.entities.getById(id);
        if (entity) {
            this.viewer.camera.cancelFlight();
            this.viewer.trackedEntity = entity;
        }
    }

    flyToEntity(id) {
        if (!this.viewer) return;
        this.viewer.trackedEntity = undefined; 
        this.viewer.camera.cancelFlight();
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
        
        const positionProperty = new Cesium.SampledPositionProperty();
        positionProperty.setInterpolationOptions({
            interpolationDegree: 5,
            interpolationAlgorithm: Cesium.LagrangePolynomialApproximation
        });

        positionProperty.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
        positionProperty.backwardExtrapolationType = Cesium.ExtrapolationType.HOLD;

        if (history && history.length > 0) {
            history.forEach(p => {
                const time = Cesium.JulianDate.fromDate(new Date(p.utc));
                const pos = Cesium.Cartesian3.fromDegrees(p['position.longitude'], p['position.latitude'], p['position.altitude']);
                positionProperty.addSample(time, pos);
            });
        }

        this.viewer.entities.add({
            id: id,
            name: child.name,
            position: positionProperty,
            viewFrom: new Cesium.Cartesian3(-10000.0, -10000.0, 5000.0), 
            point: { pixelSize: 10, color: Cesium.Color.CYAN, outlineWidth: 2, outlineColor: Cesium.Color.WHITE },
            label: {
                text: child.name,
                font: '12pt monospace',
                pixelOffset: new Cesium.Cartesian2(0, -25),
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                outlineWidth: 2,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                disableDepthTestDistance: Number.POSITIVE_INFINITY 
            },
            path: {
                resolution: 1,
                material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.1, color: Cesium.Color.CYAN }),
                width: 3,
                leadTime: 3600, 
                trailTime: 3600  
            }
        });

        this.entitiesMap.set(id, positionProperty);
    }

    updateSatellite(id, datum) {
        const property = this.entitiesMap.get(id);
        if (property) {
            const time = Cesium.JulianDate.fromDate(new Date(datum.utc));
            const pos = Cesium.Cartesian3.fromDegrees(datum['position.longitude'], datum['position.latitude'], datum['position.altitude']);
            property.addSample(time, pos);
        }
    }

    destroy() {
        if (typeof this.stopBounds === 'function') this.stopBounds();
        if (this.viewer) {
            this.viewer.destroy();
            this.viewer = null;
        }
        this.entitiesMap.clear();
    }
}

export default new CesiumService();