import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

export class CesiumService {
    constructor() {
        this.viewer = null;
        this.entitiesMap = new Map();
        this.stopBounds = null;
    }

    init(container, openmct) {
        if (this.viewer) return;

        this.viewer = new Cesium.Viewer(container, {
            animation: false,
            timeline: false,
            requestRenderMode: false, 
            sceneModePicker: true,
            baseLayerPicker: true,
            navigationHelpButton: false,
            infoBox: false,
            creditContainer: document.createElement("div")
        });

        // Set the clock to SYSTEM_CLOCK so it moves smoothly on its own
        this.viewer.clock.clockStep = Cesium.ClockStep.SYSTEM_CLOCK;
        this.viewer.clock.shouldAnimate = true;

        if (this.stopBounds) this.stopBounds();

        this.stopBounds = openmct.time.on('bounds', (bounds) => {
            // Only sync the clock when the user manually scrubs or bounds change, 
            // NOT on every telemetry tick.
            if (this.viewer && !openmct.time.isRealTime()) {
                this.viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(bounds.end));
            }
        });

        this.viewer.resize();
    }

    getOrientation(datum) {
        const position = Cesium.Cartesian3.fromDegrees(
            datum['position.longitude'] || 0, 
            datum['position.latitude'] || 0, 
            datum['position.altitude'] || 400000
        );
        const hpr = new Cesium.HeadingPitchRoll(
            Cesium.Math.toRadians(datum['attitude.heading'] || 0),
            Cesium.Math.toRadians(datum['attitude.pitch'] || 0),
            Cesium.Math.toRadians(datum['attitude.roll'] || 0)
        );
        return Cesium.Transforms.headingPitchRollQuaternion(position, hpr);
    }

    async addSatellite(child, openmct) {
        const id = openmct.objects.makeKeyString(child.identifier);
        if (this.entitiesMap.has(id)) return;

        const positionProperty = new Cesium.SampledPositionProperty();
        const orientationProperty = new Cesium.SampledProperty(Cesium.Quaternion);
        
        // Lagrange is often more stable for web-based telemetry streams
        positionProperty.setInterpolationOptions({
            interpolationDegree: 1,
            interpolationAlgorithm: Cesium.LagrangePolynomialApproximation
        });

        // This allows the satellite to keep moving even if there's a tiny network lag
        positionProperty.forwardExtrapolationType = Cesium.ExtrapolationType.EXTRAPOLATE;

        const bounds = openmct.time.getBounds();
        const history = await openmct.telemetry.request(child, bounds);
        
        if (history && history.length > 0) {
            history.forEach(p => {
                const time = Cesium.JulianDate.fromDate(new Date(p.utc));
                const pos = Cesium.Cartesian3.fromDegrees(p['position.longitude'], p['position.latitude'], p['position.altitude']);
                positionProperty.addSample(time, pos);
                orientationProperty.addSample(time, this.getOrientation(p));
            });
        }

        this.viewer.entities.add({
            id: id,
            name: child.name,
            position: positionProperty,
            orientation: orientationProperty,
            model: {
                uri: child.modelUrl || '/Satellite.glb',
                scale: parseFloat(child.modelScale) || 1.0
            },
            path: {
                resolution: 1,
                material: new Cesium.PolylineGlowMaterialProperty({ 
                    glowPower: 0.2, 
                    color: Cesium.Color.CYAN 
                }),
                width: 4,
                leadTime: 0,
                trailTime: 1800 
            },
            label: {
                text: child.name,
                font: '12pt monospace',
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                outlineWidth: 2,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -30),
                distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 10000000)
            }
        });

        this.entitiesMap.set(id, { positionProperty, orientationProperty, lastUpdateTime: 0 });
    }

    updateSatellite(id, datum) {
        const props = this.entitiesMap.get(id);
        if (props) {
            if (datum.utc <= props.lastUpdateTime) return;
            
            const time = Cesium.JulianDate.fromDate(new Date(datum.utc));
            const pos = Cesium.Cartesian3.fromDegrees(datum['position.longitude'], datum['position.latitude'], datum['position.altitude']);
            
            props.positionProperty.addSample(time, pos);
            props.orientationProperty.addSample(time, this.getOrientation(datum));
            props.lastUpdateTime = datum.utc;

            // DO NOT set this.viewer.clock.currentTime here.
            // Let the SYSTEM_CLOCK move the viewer forward naturally.
        }
    }

    // ... (rest of the methods: trackEntity, flyToEntity, resetView, removeSatellite) ...
    
    trackEntity(id) {
        const entity = this.viewer?.entities.getById(id);
        if (entity) this.viewer.trackedEntity = entity;
    }

    flyToEntity(id) {
        const entity = this.viewer?.entities.getById(id);
        if (entity) {
            this.viewer.flyTo(entity, {
                offset: new Cesium.HeadingPitchRange(0, -0.5, 5000)
            });
        }
    }

    resetView() {
        if (this.viewer) {
            this.viewer.trackedEntity = undefined;
            this.viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(0.0, 0.0, 20000000.0)
            });
        }
    }

    removeSatellite(id) {
        this.viewer?.entities.removeById(id);
        this.entitiesMap.delete(id);
    }

    destroy() {
        if (typeof this.stopBounds === 'function') {
            this.stopBounds();
            this.stopBounds = null;
        }
        if (this.viewer) {
            this.viewer.destroy();
            this.viewer = null;
        }
        this.entitiesMap.clear();
    }
}

export default CesiumService;