<script setup lang="ts">
import { computed } from 'vue'
import { authState, hasAuth } from '@/auth'
import ChatView from '@/views/ChatView.vue'
import GuestChatView from '@/views/GuestChatView.vue'

const authenticated = computed(() => {
  void authState.status
  void authState.accessToken
  return hasAuth()
})
</script>

<template>
  <ChatView v-if="authenticated" :key="authState.user?.id" />
  <GuestChatView v-else />
</template>
