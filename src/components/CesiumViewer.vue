<template>
    <div ref="cesiumContainer" class="cesium-viewer-wrapper"></div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, inject } from 'vue';

const props = defineProps(['domainObject']);
const openmct = inject('openmct');
const cesiumService = inject('cesiumService');
const cesiumContainer = ref(null);
const unsubscribes = new Map();
let resizeObserver;

onMounted(() => {
    cesiumService.init(cesiumContainer.value, openmct);

    const composition = openmct.composition.get(props.domainObject);
    
    const onAdd = (child) => {
        const id = openmct.objects.makeKeyString(child.identifier);
        
        if (child.type === 'satellite') {
            cesiumService.addSatellite(child, openmct);
        }

        // If a sensor is added, we observe it for property changes
        if (child.type === 'satellite.sensor') {
            const parentId = openmct.objects.makeKeyString(props.domainObject.composition[0]); // Simplified parent lookup
            
            // Listen for user editing FOV, Range, or Shape
            openmct.objects.observe(child, '*', (newObj) => {
                cesiumService.addSensor(parentId, newObj); 
            });
        }
    };

    const onRemove = (identifier) => {
        const id = openmct.objects.makeKeyString(identifier);
        cesiumService.removeSatellite(id);
        if (unsubscribes.has(id)) {
            unsubscribes.get(id)();
            unsubscribes.delete(id);
        }
    };

    composition.on('add', onAdd);
    composition.on('remove', onRemove);
    composition.load();

    resizeObserver = new ResizeObserver(() => {
        if (cesiumService.viewer) cesiumService.viewer.resize();
    });
    resizeObserver.observe(cesiumContainer.value);
});

onBeforeUnmount(() => {
    if (resizeObserver) resizeObserver.disconnect();
    unsubscribes.forEach(unsub => unsub());
});
</script>
<style lang="scss">
  /* Change @import to @use */
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
    z-index: 1; /* Ensure it stays above background layers */
}

:deep(.cesium-viewer), :deep(.cesium-widget) {
    width: 100% !important;
    height: 100% !important;
}
</style>