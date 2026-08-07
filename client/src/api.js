const TOKEN_KEY = 'quotebook_token'

export const auth = {
  token: () => localStorage.getItem(TOKEN_KEY),
  set: (token) => token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

async function request(path, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
  const token = auth.token()
  if (token) headers.Authorization = `Bearer ${token}`
  let response
  try { response = await fetch(`/api${path}`, { ...options, headers }) }
  catch (error) { if (error.name === 'AbortError') throw error; throw new Error('Could not reach Quotebook. Check your connection and try again.') }
  const data = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) {
    if (response.status === 401 && token) {
      auth.clear()
      window.dispatchEvent(new CustomEvent('quotebook:unauthorized'))
    }
    const message = typeof data?.error === 'string' ? data.error : data?.error?.message || data?.message
    const error = new Error(message || 'Something went wrong. Please try again.')
    error.status = response.status
    error.code = data?.error?.code
    throw error
  }
  return data
}

export const api = {
  me: () => request('/auth/me'),
  login: (credentials) => request('/auth/login', { method: 'POST', body: JSON.stringify(credentials) }),
  signup: (credentials) => request('/auth/signup', { method: 'POST', body: JSON.stringify(credentials) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  categories: () => request('/categories'),
  setupCategories: (categories) => request('/categories/setup', { method: 'POST', body: JSON.stringify({ categories }) }),
  createCategory: (name) => request('/categories', { method: 'POST', body: JSON.stringify({ name }) }),
  quotes: ({ category, search, signal } = {}) => {
    const query = new URLSearchParams()
    if (category) query.set('category', category)
    if (search) query.set('search', search)
    return request(`/quotes${query.size ? `?${query}` : ''}`, { signal })
  },
  analyzeQuote: (text, searchOnline, availableCategories = []) => request('/ai/parse', { method: 'POST', body: JSON.stringify({ text, searchOnline, availableCategories }) }),
  splitQuotes: (text) => request('/ai/split', { method: 'POST', body: JSON.stringify({ text }) }),
  saveQuote: (quote) => request('/quotes', { method: 'POST', body: JSON.stringify(quote) }),
}
