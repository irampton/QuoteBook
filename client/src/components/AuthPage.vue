<template>
  <main class="grid min-h-screen lg:grid-cols-[1.05fr_.95fr]">
    <section class="relative hidden overflow-hidden bg-sage-dark p-14 text-white lg:flex lg:flex-col lg:justify-between">
      <div class="absolute -top-36 -right-24 size-96 rounded-full border border-white/10" />
      <div class="absolute -top-16 -right-10 size-60 rounded-full border border-white/10" />
      <BrandMark caption />
      <div class="relative max-w-xl">
        <div class="mb-8 font-serif text-8xl leading-none text-white/20">“</div>
        <h1 class="font-serif text-5xl leading-[1.16] font-medium">A quiet home for the words that move you.</h1>
        <p class="mt-7 max-w-md text-base leading-7 text-white/65">Capture a line, uncover its story, and find it again exactly when you need it.</p>
      </div>
      <p class="text-xs text-white/40">Your personal collection. Thoughtfully organized.</p>
    </section>

    <section class="flex items-center justify-center p-6 sm:p-10">
      <div class="w-full max-w-md">
        <div class="mb-12 lg:hidden"><BrandMark caption /></div>
        <p class="mb-2 text-sm font-semibold text-sage">{{ mode === 'login' ? 'Welcome back' : 'Begin your collection' }}</p>
        <h2 class="font-serif text-4xl font-semibold">{{ mode === 'login' ? 'Sign in to Quotebook' : 'Create your account' }}</h2>
        <p class="mt-3 text-sm leading-6 text-ink/55">{{ mode === 'login' ? 'Your saved words are waiting.' : 'No email required—just choose a username and password.' }}</p>

        <p v-if="notice" class="mt-7 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">{{ notice }}</p>
        <form :class="['space-y-5', notice ? 'mt-5' : 'mt-9']" @submit.prevent="submit">
          <div>
            <label class="label" for="username">Username</label>
            <input id="username" v-model.trim="form.username" class="field" autocomplete="username" minlength="3" maxlength="32" required placeholder="Your username" />
          </div>
          <div>
            <label class="label" for="password">Password</label>
            <div class="relative">
              <input id="password" v-model="form.password" class="field pr-12" :type="showPassword ? 'text' : 'password'" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" minlength="8" maxlength="256" required placeholder="At least 8 characters" />
              <button type="button" class="absolute inset-y-0 right-0 px-4 text-ink/45 hover:text-ink" :aria-label="showPassword ? 'Hide password' : 'Show password'" @click="showPassword = !showPassword">
                <EyeOff v-if="showPassword" :size="18"/><Eye v-else :size="18"/>
              </button>
            </div>
          </div>
          <p v-if="error" class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{{ error }}</p>
          <button class="btn-primary w-full" :disabled="loading">
            <LoadingSpinner v-if="loading" small />{{ loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account' }}
          </button>
        </form>

        <p class="mt-7 text-center text-sm text-ink/55">
          {{ mode === 'login' ? 'New to Quotebook?' : 'Already have an account?' }}
          <button class="ml-1 font-semibold text-sage hover:underline" @click="switchMode">{{ mode === 'login' ? 'Sign up' : 'Sign in' }}</button>
        </p>
      </div>
    </section>
  </main>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { Eye, EyeOff } from 'lucide-vue-next'
import BrandMark from './BrandMark.vue'
import LoadingSpinner from './LoadingSpinner.vue'
import { api, auth } from '../api'

const emit = defineEmits(['authenticated'])
defineProps({ notice: { type: String, default: '' } })
const mode = ref('login')
const showPassword = ref(false)
const loading = ref(false)
const error = ref('')
const form = reactive({ username: '', password: '' })

function switchMode() { mode.value = mode.value === 'login' ? 'signup' : 'login'; error.value = '' }
async function submit() {
  loading.value = true; error.value = ''
  try {
    const result = mode.value === 'login' ? await api.login(form) : await api.signup(form)
    auth.set(result.token)
    emit('authenticated', { user: result.user || { username: form.username }, needsSetup: result.needsSetup ?? mode.value === 'signup' })
  } catch (e) { error.value = e.message }
  finally { loading.value = false }
}
</script>
