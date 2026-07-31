<script setup lang="ts">
import { BarChart3, ShieldCheck } from '@lucide/vue'
</script>

<template>
  <section class="settings-frame">
    <aside class="settings-frame__nav" aria-label="设置分类">
      <h1>设置</h1>
      <nav>
        <RouterLink to="/settings">
          <ShieldCheck :size="18" :stroke-width="1.8" aria-hidden="true" />
          <span>账号与安全</span>
        </RouterLink>
        <RouterLink to="/settings/usage">
          <BarChart3 :size="18" :stroke-width="1.8" aria-hidden="true" />
          <span>AI 用量</span>
        </RouterLink>
      </nav>
    </aside>
    <div class="settings-frame__content">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.settings-frame {
  display: grid;
  width: 100%;
  min-width: 0;
  min-height: calc(100dvh - var(--lyle-header-height));
  grid-template-columns: 248px minmax(0, 1fr);
  overflow: hidden;
  border: 0;
  background: var(--surface);
}

.settings-frame__nav {
  border-right: 1px solid var(--border);
  padding: 24px 16px;
}

.settings-frame__nav h1 {
  margin: 0 8px 18px;
  font-size: 17px;
}

.settings-frame__nav nav {
  display: grid;
  gap: 6px;
}

.settings-frame__nav a {
  display: flex;
  min-height: 42px;
  align-items: center;
  gap: 10px;
  border-radius: 7px;
  color: var(--muted-foreground);
  padding: 0 12px;
  font-size: 14px;
  font-weight: 650;
}

.settings-frame__nav a:hover {
  background: var(--surface-muted);
  color: var(--foreground);
}

.settings-frame__nav a.router-link-exact-active {
  position: relative;
  background: var(--primary-soft);
  color: var(--primary);
}

.settings-frame__nav a.router-link-exact-active::before {
  position: absolute;
  top: 8px;
  bottom: 8px;
  left: -5px;
  width: 3px;
  border-radius: 3px;
  background: var(--primary);
  content: '';
}

.settings-frame__content {
  min-width: 0;
  overflow: hidden;
  padding: 17px 18px 30px 32px;
}

@media (max-width: 800px) {
  .settings-frame {
    width: 100%;
    min-height: auto;
    grid-template-columns: 1fr;
    overflow: visible;
  }
  .settings-frame__nav {
    border-right: 0;
    border-bottom: 1px solid var(--border);
    padding: 16px;
  }
  .settings-frame__nav h1 {
    margin-bottom: 12px;
  }
  .settings-frame__nav nav {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .settings-frame__nav a {
    justify-content: center;
    gap: 5px;
    padding: 0 6px;
    font-size: 12px;
  }
  .settings-frame__nav a.router-link-exact-active::before {
    inset: auto 12px -5px;
    width: auto;
    height: 3px;
  }
  .settings-frame__content {
    width: 100%;
    padding: 20px 16px 24px;
  }
}
</style>
