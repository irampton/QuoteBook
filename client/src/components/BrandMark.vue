<template>
  <div class="flex items-center gap-3">
    <span class="grid size-10 place-items-center rounded-xl bg-sage text-xl font-serif text-white">“</span>
    <div>
      <div class="font-serif text-xl font-semibold tracking-tight">Quotebook</div>
      <div v-if="caption" class="text-[10px] tracking-[.16em] text-ink/45 uppercase">Words worth keeping</div>
    </div>
  </div>
</template>

<script setup>
defineProps({ caption: { type: Boolean, default: false } })
</script>
