<template>
    <div ref="cesiumContainer" class="cesium-viewer-container"></div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, inject } from 'vue';
import CesiumService from '../services/CesiumService.js';
import 'cesium/Build/Cesium/Widgets/widgets.css'; 

const props = defineProps(['domainObject']);
const openmct = inject('openmct');
const cesiumContainer = ref(null);
const unsubscribes = new Map();

onMounted(() => {
    CesiumService.init(cesiumContainer.value, openmct);

    const composition = openmct.composition.get(props.domainObject);
    
    const onAdd = (child) => {
        const id = openmct.objects.makeKeyString(child.identifier);
        CesiumService.addSatellite(child, openmct);

        const unsub = openmct.telemetry.subscribe(child, (datum) => {
            CesiumService.updateSatellite(id, datum);
        });
        unsubscribes.set(id, unsub);
    };

    const onRemove = (identifier) => {
        const id = openmct.objects.makeKeyString(identifier);
        CesiumService.removeSatellite(id);
        if (unsubscribes.has(id)) {
            unsubscribes.get(id)();
            unsubscribes.delete(id);
        }
    };

    composition.on('add', onAdd);
    composition.on('remove', onRemove);
    composition.load();
});

onBeforeUnmount(() => {
    unsubscribes.forEach(unsub => unsub());
    CesiumService.destroy();
});
</script>

<style scoped>
.cesium-viewer-container {
    width: 100%;
    height: 100%;
    position: absolute; /* Changed from relative to absolute to fill the frame */
    top: 0;
    left: 0;
    background: #000;
}
:deep(.cesium-viewer) {
    width: 100%;
    height: 100%;
}
</style>