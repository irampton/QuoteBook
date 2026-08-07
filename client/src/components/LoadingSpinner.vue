<template>
  <div :class="['inline-block rounded-full border-2 border-current border-r-transparent gentle-spin', small ? 'size-4' : 'size-6']" aria-hidden="true" />
</template>
<script setup>defineProps({ small: Boolean })</script>
