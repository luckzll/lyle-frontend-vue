<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { FolderKanban, ListTodo } from '@lucide/vue'
import type { TaskAreaMode } from '@/app/navigation'

defineProps<{ active: TaskAreaMode }>()
</script>

<template>
  <div class="task-mode-nav">
    <nav class="task-mode-links" aria-label="任务分类">
      <RouterLink to="/tasks" class="task-mode-link" :class="{ selected: active === 'todos' }" :aria-current="active === 'todos' ? 'page' : undefined">
        <ListTodo :size="16" aria-hidden="true" /><span>待办与日程</span>
      </RouterLink>
      <RouterLink to="/projects" class="task-mode-link" :class="{ selected: active === 'projects' }" :aria-current="active === 'projects' ? 'page' : undefined">
        <FolderKanban :size="16" aria-hidden="true" /><span>项目计划</span>
      </RouterLink>
    </nav>
    <p class="task-mode-description">{{ active === 'todos' ? '安排待办、日程和提醒' : '围绕目标组织任务、计划和资料' }}</p>
  </div>
</template>

<style scoped>
.task-mode-nav { display: flex; flex: 0 0 auto; align-items: center; gap: 24px; box-sizing: border-box; width: 100%; min-width: 0; min-height: 64px; padding: 10px 24px; border-bottom: 1px solid var(--border); background: var(--surface); }
.task-mode-links { display: flex; flex: 0 0 auto; align-items: center; gap: 4px; }
.task-mode-link { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 36px; padding: 7px 12px; box-sizing: border-box; border: 1px solid transparent; border-radius: 8px; color: var(--muted-foreground); font-size: 13px; font-weight: 550; line-height: 20px; white-space: nowrap; text-decoration: none; }
.task-mode-link svg { flex-shrink: 0; }
.task-mode-link:hover { color: var(--foreground); background: var(--surface-muted); }
.task-mode-link.selected { color: var(--primary); border-color: var(--primary-border); background: var(--primary-soft); font-weight: 650; }
.task-mode-link:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
.task-mode-description { min-width: 0; margin: 0; color: var(--muted-foreground); font-size: 12px; line-height: 18px; }
@media (max-width: 639px) {
  .task-mode-nav { flex-direction: column; align-items: flex-start; gap: 3px; min-height: 68px; padding: 7px 12px; }
  .task-mode-link { min-height: 32px; padding: 5px 10px; font-size: 12px; }
  .task-mode-description { padding-left: 10px; font-size: 11px; line-height: 17px; }
}
</style>
