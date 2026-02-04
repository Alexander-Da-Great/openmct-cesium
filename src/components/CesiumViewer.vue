<template>
    <div ref="cesiumContainer" class="cesium-viewer-wrapper"></div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, inject } from 'vue';

const props = defineProps(['domainObject']);
const openmct = inject('openmct');
const cesiumService = inject('cesiumService');
const cesiumContainer = ref(null);

// Store unobserve/unsubscribe functions to prevent memory leaks
const unsubscribes = new Map();
let resizeObserver;

onMounted(() => {
    // Initialize the 3D globe
    cesiumService.init(cesiumContainer.value, openmct);

    const composition = openmct.composition.get(props.domainObject);
    
    const onAdd = (child) => {
        const childId = openmct.objects.makeKeyString(child.identifier);

        if (child.type === 'satellite') {
            cesiumService.addSatellite(child, openmct);
            
            // WATCH SATELLITE FOR TOGGLES (Orbit)
            unsubscribes.set(childId, openmct.objects.observe(child, '*', (newSat) => {
                cesiumService.updateSatelliteProperties(childId, newSat);
            }));

            const sensorComposition = openmct.composition.get(child);
            sensorComposition.on('add', (sensor) => {
                const satId = openmct.objects.makeKeyString(child.identifier);
                cesiumService.addSensor(satId, sensor);
                
                // WATCH SENSOR FOR TOGGLES (Cone)
                unsubscribes.set(openmct.objects.makeKeyString(sensor.identifier), 
                    openmct.objects.observe(sensor, '*', (newVal) => {
                        cesiumService.addSensor(satId, newVal);
                    })
                );
            });
            sensorComposition.load();
        }
    };

    const onRemove = (identifier) => {
        const id = openmct.objects.makeKeyString(identifier);
        
        // If it's a satellite, remove it and its children from Cesium
        cesiumService.removeSatellite(id);

        // Clean up observers for this specific object
        if (unsubscribes.has(id)) {
            unsubscribes.get(id)();
            unsubscribes.delete(id);
        }
    };

    composition.on('add', onAdd);
    composition.on('remove', onRemove);
    composition.load();

    // Fix the "Tiny Globe" bug by resizing whenever the container changes
    resizeObserver = new ResizeObserver(() => {
        if (cesiumService.viewer) {
            cesiumService.viewer.resize();
        }
    });
    resizeObserver.observe(cesiumContainer.value);
});

onBeforeUnmount(() => {
    if (resizeObserver) resizeObserver.disconnect();
    // Clean up all Open MCT observers
    unsubscribes.forEach(unsub => unsub());
    unsubscribes.clear();
});
</script>

<style lang="scss">
  /* Modern Sass @use rule */
  @use "../styles/cesium.scss";
</style>

<style scoped>
.cesium-viewer-wrapper {
    width: 100%;
    height: 100%;
    display: block;
    position: absolute;
    top: 0;
    left: 0;
    background: #000;
    z-index: 1; 
}

/* Ensure Cesium fills the Vue container exactly */
:deep(.cesium-viewer), :deep(.cesium-widget) {
    width: 100% !important;
    height: 100% !important;
}
</style>