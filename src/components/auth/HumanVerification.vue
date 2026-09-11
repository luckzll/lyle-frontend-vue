<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { ShieldCheck, CheckCircle2, RefreshCw, CircleX, MoveRight } from '@lucide/vue'
import { publicHttp } from '@/api/http'
import { safeCaptchaImage, type CaptchaOptions, type CaptchaProof, type CaptchaImage, type CaptchaPoint } from '@/domain/captcha'

const props = defineProps<{ options: CaptchaOptions | null; disabled?: boolean; cooldownSeconds?: number; modelValue: CaptchaProof | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: CaptchaProof | null] }>()
const busy = ref(false), error = ref(''), visible = ref(false)
const challenge = ref<CaptchaImage | null>(null), position = ref(0)
const refreshing = ref(false)
let previousBackground = ''
const maxPosition = computed(() => challenge.value ? challenge.value.backgroundImageWidth - challenge.value.templateImageWidth : 0)
const points: CaptchaPoint[] = []
const startedAt = ref(0)
let generation = 0
let expiry: ReturnType<typeof setTimeout> | undefined
let abort: AbortController | undefined
function clear() {
  generation++; abort?.abort(); abort = undefined
  if (expiry) clearTimeout(expiry)
  challenge.value = null; visible.value = false; busy.value = false; position.value = 0
  startedAt.value = 0; points.length = 0
}
function close() { clear(); error.value = '' }
watch(() => props.modelValue, (value, previous) => { if (!value && previous) clear() })
watch(() => props.options, () => { clear(); emit('update:modelValue', null) })
onUnmounted(clear)
async function start() {
  if (busy.value || props.disabled || !props.options?.configured) return
  refreshing.value = !!challenge.value
  clear(); emit('update:modelValue', null); error.value = ''; busy.value = true; visible.value = true
  const current = generation
  abort = new AbortController()
  try {
    const { data } = await publicHttp.post<CaptchaImage>('/auth/captcha/challenge', { previousBackground }, { signal: abort.signal })
    if (current !== generation) return
    if (!safeCaptchaImage(data.backgroundImage) || !safeCaptchaImage(data.templateImage)
      || data.backgroundImageWidth <= data.templateImageWidth || data.backgroundImageHeight <= 0) throw new Error('Invalid challenge')
    challenge.value = data
    previousBackground = data.backgroundImageTag || ''
    expiry = setTimeout(() => { clear(); error.value = '验证已过期，请重新完成。' }, 110000)
  } catch (e) { if (current === generation) { clear(); error.value = message(e) } }
  finally { if (current === generation) busy.value = false }
}
function message(e: unknown) {
  return (e as { response?: { data?: { detail?: string; message?: string } } })?.response?.data?.detail
    || (e as { response?: { data?: { message?: string } } })?.response?.data?.message
    || '无法加载安全验证，请稍后重试。'
}
function begin() {
  if (startedAt.value) return
  startedAt.value = Date.now()
  points.push({ x: 0, y: 0, t: 0, type: 'down' })
}
function move() {
  begin()
  // Keep a bounded sample; the exact final position is always appended at submission.
  if (points.length < 250) points.push({ x: Number(position.value), y: 0, t: Date.now() - startedAt.value, type: 'move' })
}
async function confirm() {
  if (busy.value || props.disabled || !challenge.value || !startedAt.value) return
  const current = generation, image = challenge.value
  busy.value = true; error.value = ''
  const stopTime = Math.max(Date.now(), startedAt.value + 1)
  const trackList = [...points, { x: Number(position.value), y: 0, t: stopTime - startedAt.value, type: 'up' }]
  abort = new AbortController()
  try {
    const { data } = await publicHttp.post<CaptchaProof>('/auth/captcha/verify', {
      id: image.id, track: { startTime: startedAt.value, stopTime, trackList }
    }, { signal: abort.signal })
    if (current !== generation) return
    if (!/^[A-Za-z0-9_-]{43}$/.test(data.captchaToken)) throw new Error('Invalid proof')
    clear(); emit('update:modelValue', { captchaToken: data.captchaToken })
    expiry = setTimeout(() => { emit('update:modelValue', null); error.value = '验证已过期，请重新完成。' }, 110000)
  } catch (e) { if (current === generation) { clear(); error.value = message(e) } }
  finally { if (current === generation) busy.value = false }
}
</script>

<template>
  <div class="human-verification">
    <div v-if="!visible" class="verification-row" :class="{ 'is-solved': modelValue }">
      <CheckCircle2 v-if="modelValue" :size="20" aria-hidden="true" /><ShieldCheck v-else :size="20" aria-hidden="true" />
      <div class="verification-copy"><strong>{{ modelValue ? '安全验证已通过' : '安全验证' }}</strong></div>
      <button type="button" :disabled="disabled || busy || !options?.configured || !!modelValue" :aria-label="modelValue ? '安全验证已完成' : cooldownSeconds ? '等待验证码发送冷却结束' : '点击完成验证'" @click="start">{{ modelValue ? '已完成' : busy ? '加载中…' : cooldownSeconds ? '等待重发' : '点击完成验证' }}</button>
    </div>
    <section v-if="visible" class="captcha-panel" aria-label="滑块拼图验证" :aria-busy="busy">
      <header><strong>拖动滑块完成拼图</strong></header>
      <p v-if="!challenge" role="status">{{ refreshing ? '正在更换拼图…' : '正在生成拼图…' }}</p>
      <template v-else>
        <div class="captcha-image" :style="{ aspectRatio: challenge.backgroundImageWidth + '/' + challenge.backgroundImageHeight }">
          <img :src="challenge.backgroundImage" alt="请将移动拼图对准背景中的缺口" draggable="false" />
          <img class="captcha-piece" :src="challenge.templateImage" alt="" draggable="false"
            :style="{ width: (challenge.templateImageWidth / challenge.backgroundImageWidth * 100) + '%', left: (Number(position) / challenge.backgroundImageWidth * 100) + '%', height: (challenge.templateImageHeight / challenge.backgroundImageHeight * 100) + '%' }" />
        </div>
        <div class="captcha-slider-wrap">
        <input v-model="position" class="captcha-slider" type="range" min="0" :max="maxPosition" step="1"
          :style="{ '--slider-progress': (maxPosition ? Number(position) / maxPosition * 100 : 0) + '%' }"
          aria-label="移动拼图位置" :disabled="busy" @pointerdown="begin" @input="move" @pointerup="confirm" @keydown.enter.prevent="confirm" />
        <span class="slider-arrow" aria-hidden="true" :style="{ left: 'calc(' + (maxPosition ? Number(position) / maxPosition * 100 : 0) + '% - ' + (maxPosition ? Number(position) / maxPosition * 54 : 0) + 'px)' }"><MoveRight :size="27" :stroke-width="2.5" /></span>
        </div>
        <footer><span class="captcha-credit">{{ busy ? '正在核验…' : '天爱验证码' }}</span><div class="captcha-actions"><button type="button" :disabled="busy" aria-label="换一张" title="换一张" @click="start"><RefreshCw :size="21" /></button><button type="button" aria-label="关闭滑块验证" title="关闭" @click="close"><CircleX :size="21" /></button></div></footer>
        <p class="keyboard-help">松手自动验证 · 也可用方向键调整后按回车</p>
      </template>
    </section>
    <p v-if="error" class="verification-error" role="alert">{{ error }} <button type="button" :disabled="busy || disabled" @click="start">重新验证</button></p>
  </div>
</template>

<style scoped>
.verification-row { display: flex; align-items: center; gap: 10px; min-height: 54px; box-sizing: border-box; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; }
.verification-row > svg { flex-shrink: 0; color: #334155; }
.verification-copy { flex: 1; min-width: 0; }
.verification-copy strong { font-size: 14px; font-weight: 600; line-height: 1.5; }
.verification-row button { flex-shrink: 0; min-height: 36px; border: 0; border-radius: 7px; padding: 7px 10px; background: #eef2ff; color: #4338ca; font-size: 13px; font-weight: 600; line-height: 1.4; white-space: nowrap; }
button:focus-visible,.captcha-slider:focus-visible { outline: 3px solid #a5b4fc; outline-offset: 3px; }
button:disabled { cursor: not-allowed; opacity: .65; }
.is-solved { background: #ecfdf5; border-color: #a7f3d0; }
.is-solved > svg,.is-solved strong { color: #047857; }
.verification-error { margin: 10px 0 0; font-size: 13px; color: #b91c1c; }
.verification-error button { border: 0; background: transparent; color: #4338ca; text-decoration: underline; padding: 8px; }
.captcha-panel { margin-top: 12px; padding: 12px; width: 100%; max-width: 360px; box-sizing: border-box; border: 1px solid #dfe3e8; border-radius: 6px; background: #fff; box-shadow: 0 2px 8px #0f172a0a; }
.captcha-panel header,.captcha-panel footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.captcha-panel header { margin-bottom: 8px; font-size: 15px; color: #252a30; }
.captcha-panel button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 0; background: transparent; color: #727b84; padding: 8px; min-height: 40px; border-radius: 6px; }
.captcha-panel button:hover:not(:disabled) { color: #4f46e5; background: #f5f6fa; }
.captcha-actions { display: flex; align-items: center; gap: 0; }
.captcha-credit { font-size: 12px; color: #64748b; white-space: nowrap; }
.captcha-image { position: relative; overflow: hidden; width: 100%; border-radius: 6px; }
.captcha-image > img { display: block; width: 100%; height: 100%; user-select: none; }
.captcha-image > .captcha-piece { position: absolute; top: 0; object-fit: fill; pointer-events: none; }
.captcha-slider-wrap { position: relative; margin: 12px 0 4px; height: 46px; }
.slider-arrow { position: absolute; top: 0; width: 54px; height: 46px; display: grid; place-items: center; color: #899199; pointer-events: none; }
.captcha-slider { appearance: none; -webkit-appearance: none; display: block; box-sizing: border-box; width: 100%; height: 46px; margin: 0; padding: 0; border: 0; border-radius: 4px; background: transparent; touch-action: pan-y; cursor: grab; box-shadow: none; }
.captcha-slider:active { cursor: grabbing; }
.captcha-slider::-webkit-slider-runnable-track { height: 44px; border: 1px solid #e9ecf0; border-radius: 4px; background: #f5f6f7; }
.captcha-slider::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; box-sizing: border-box; width: 54px; height: 44px; margin-top: -1px; border: 1px solid #e3e7ec; border-radius: 4px; background: #fff; box-shadow: 1px 0 4px #0f172a08; }
.captcha-slider::-moz-range-track { height: 42px; border: 1px solid #e9ecf0; border-radius: 4px; background: #f5f6f7; }
.captcha-slider::-moz-range-progress { height: 42px; border-radius: 4px; background: #eceff3; }
.captcha-slider::-moz-range-thumb { box-sizing: border-box; width: 54px; height: 44px; border: 1px solid #e3e7ec; border-radius: 4px; background: #fff; box-shadow: 1px 0 4px #0f172a08; }
.captcha-slider:disabled { cursor: wait; opacity: .6; }
.captcha-panel { margin-top: 0; }
.keyboard-help { color: #64748b; font-size: 12px; line-height: 1.5; margin: 4px 0 0; }
@media(max-width: 520px) { .verification-row { gap: 8px; padding: 7px 10px; } .verification-copy strong { font-size: 13px; } .verification-row button { font-size: 12px; padding: 7px 9px; } }
</style>
