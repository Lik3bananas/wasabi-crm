'use client'

import { useCallback, useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

interface Customer {
  id: number
  full_name: string
  email: string
  phone: string
  city: string
  state: string
  total_spent: string
  purchase_count: number
  last_purchase_date: string
  source_channel: string
  is_active: boolean
}

function fmt(val: string | number) {
  return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

function ClientesContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [search, setSearch]   = useState(searchParams.get('search') || '')
  const [city, setCity]       = useState(searchParams.get('city') || '')
  const [state, setState]     = useState(searchParams.get('state') || '')
  const [filter, setFilter]   = useState(searchParams.get('filter') || '')
  const [dateFrom, setDateFrom] = useState(searchParams.get('date_from') || '')
  const [dateTo, setDateTo]   = useState(searchParams.get('date_to') || '')
  const [cepInput, setCepInput] = useState('')
  const [ceps, setCeps] = useState<string[]>(
    searchParams.get('ceps') ? searchParams.get('ceps')!.split(',').filter(Boolean) : []
  )
  const [page, setPage] = useState(Number(searchParams.get('page') || 1))

  // Advanced segmentation
  const [inactivePreset, setInactivePreset]       = useState(searchParams.get('inactive_preset') || '')
  const [customInactiveDays, setCustomInactiveDays] = useState(searchParams.get('inactive_days') || '')
  const [purchasePreset, setPurchasePreset]       = useState(searchParams.get('purchase_preset') || '')
  const [customMinPurchases, setCustomMinPurchases] = useState('')
  const [sortBy,  setSortBy]  = useState('name')
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('asc')

  const [customers, setCustomers] = useState<Customer[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  const buildQuery = useCallback(() => {
    const p = new URLSearchParams()
    if (search)   p.set('search',   search)
    if (city)     p.set('city',     city)
    if (state)    p.set('state',    state)
    if (filter)   p.set('filter',   filter)
    if (dateFrom) p.set('date_from', dateFrom)
    if (dateTo)   p.set('date_to',   dateTo)
    if (ceps.length > 0) p.set('ceps', ceps.join(','))

    // Inactivity segmentation
    const inactiveDays = inactivePreset === 'custom'
      ? Number(customInactiveDays)
      : Number(inactivePreset)
    if (inactiveDays > 0) p.set('inactive_days', String(inactiveDays))
    if (inactivePreset)   p.set('inactive_preset', inactivePreset)

    // Purchase frequency segmentation
    if (purchasePreset === '1_only') {
      p.set('min_purchases', '1')
      p.set('max_purchases', '1')
    } else if (purchasePreset === 'custom') {
      const v = Number(customMinPurchases)
      if (v > 0) p.set('min_purchases', String(v))
    } else if (purchasePreset) {
      p.set('min_purchases', purchasePreset)
    }
    if (purchasePreset) p.set('purchase_preset', purchasePreset)
    p.set('sort_by',  sortBy)
    p.set('sort_dir', sortDir)
    p.set('page', String(page))
    return p.toString()
  }, [search, city, state, filter, dateFrom, dateTo, ceps, inactivePreset, customInactiveDays, purchasePreset, customMinPurchases, sortBy, sortDir, page])

  useEffect(() => {
    setLoading(true)
    fetch(`/api/customers?${buildQuery()}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((d) => {
        setCustomers(d.customers || [])
        setTotal(d.total || 0)
        setTotalPages(d.totalPages || 1)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [buildQuery])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setPage(1)
  }

  function handleSort(col: string) {
    if (sortBy === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(col)
      setSortDir('asc')
    }
    setPage(1)
  }

  function SortIcon({ col }: { col: string }) {
    if (sortBy !== col) return <span className="ml-1 text-gray-300">↕</span>
    return <span className="ml-1 text-green-600">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  function handleReset() {
    setSearch(''); setCity(''); setState(''); setFilter(''); setDateFrom(''); setDateTo('')
    setCeps([]); setCepInput('')
    setInactivePreset(''); setCustomInactiveDays('')
    setPurchasePreset(''); setCustomMinPurchases('')
    setPage(1)
  }

  // Normalise and add a CEP chip (digits only, 8 chars max, up to 30 total)
  function addCep(raw: string) {
    const clean = raw.replace(/\D/g, '').slice(0, 8)
    if (clean.length < 5) return
    if (ceps.includes(clean)) { setCepInput(''); return }
    if (ceps.length >= 30) return
    setCeps(prev => [...prev, clean])
    setCepInput('')
  }

  function removeCep(cep: string) {
    setCeps(prev => prev.filter(c => c !== cep))
  }

  // Display format: XXXXX-XXX
  function fmtCep(cep: string) {
    return cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep
  }

  async function handleExport() {
    setExporting(true)
    const qs = buildQuery()
    const res = await fetch(`/api/export?${qs}`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `clientes-${new Date().toISOString().slice(0, 10)}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
    setExporting(false)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Clientes</h1>
          <p className="text-gray-500 text-sm mt-1">{total.toLocaleString('pt-BR')} cliente(s) encontrado(s)</p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || customers.length === 0}
          className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50"
        >
          📥 {exporting ? 'Exportando...' : 'Exportar Excel'}
        </button>
      </div>

      <form onSubmit={handleSearch} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">

        {/* Row 1 — basic search */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nome, e-mail ou telefone"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Cidade"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <input
            value={state}
            onChange={(e) => setState(e.target.value)}
            placeholder="Estado (ex: SP)"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
          >
            <option value="">Todos os clientes</option>
            <option value="best_buyers">Melhores compradores</option>
          </select>
        </div>

        {/* Row 2 — advanced segmentation */}
        <div className="border border-gray-100 rounded-lg p-3 mb-3 bg-gray-50">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Segmentação de comportamento</p>
          <div className="flex flex-wrap gap-3 items-start">

            {/* Inactivity filter */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Inativo há</label>
              <div className="flex gap-2 items-center">
                <select
                  value={inactivePreset}
                  onChange={(e) => { setInactivePreset(e.target.value); setCustomInactiveDays('') }}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                >
                  <option value="">Qualquer período</option>
                  <option value="30">+ 30 dias</option>
                  <option value="60">+ 60 dias</option>
                  <option value="90">+ 90 dias</option>
                  <option value="180">+ 6 meses</option>
                  <option value="365">+ 1 ano</option>
                  <option value="730">+ 2 anos</option>
                  <option value="custom">Personalizado...</option>
                </select>
                {inactivePreset === 'custom' && (
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={1}
                      value={customInactiveDays}
                      onChange={(e) => setCustomInactiveDays(e.target.value)}
                      placeholder="dias"
                      className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                    <span className="text-xs text-gray-400">dias</span>
                  </div>
                )}
              </div>
            </div>

            {/* Purchase count filter */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Nº de compras</label>
              <div className="flex gap-2 items-center">
                <select
                  value={purchasePreset}
                  onChange={(e) => { setPurchasePreset(e.target.value); setCustomMinPurchases('') }}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                >
                  <option value="">Qualquer</option>
                  <option value="1_only">Apenas 1 (sem retorno)</option>
                  <option value="2">2 ou mais</option>
                  <option value="3">3 ou mais</option>
                  <option value="4">4 ou mais</option>
                  <option value="5">5 ou mais</option>
                  <option value="custom">Personalizado...</option>
                </select>
                {purchasePreset === 'custom' && (
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={1}
                      value={customMinPurchases}
                      onChange={(e) => setCustomMinPurchases(e.target.value)}
                      placeholder="mín"
                      className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-20 focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                    <span className="text-xs text-gray-400">ou mais</span>
                  </div>
                )}
              </div>
            </div>

            {/* Active filter summary badge */}
            {(inactivePreset || purchasePreset) && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500 opacity-0">.</label>
                <div className="flex items-center gap-1 flex-wrap">
                  {inactivePreset && (
                    <span className="text-xs px-2 py-1 rounded-full bg-orange-100 text-orange-700 font-medium">
                      Inativo {inactivePreset === 'custom'
                        ? `+${customInactiveDays || '?'} dias`
                        : inactivePreset === '180' ? '+6 meses'
                        : inactivePreset === '365' ? '+1 ano'
                        : inactivePreset === '730' ? '+2 anos'
                        : `+${inactivePreset} dias`}
                    </span>
                  )}
                  {purchasePreset && (
                    <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700 font-medium">
                      {purchasePreset === '1_only' ? '1 compra apenas'
                        : purchasePreset === 'custom' ? `${customMinPurchases || '?'}+ compras`
                        : `${purchasePreset}+ compras`}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Row 3 — date range + actions */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>Compras entre</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            <span>e</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <div className="flex gap-2 ml-auto">
            <button type="button" onClick={handleReset}
              className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition">
              Limpar
            </button>
            <button type="submit"
              className="text-sm bg-green-600 text-white px-4 py-1.5 rounded-lg hover:bg-green-700 transition font-medium">
              Buscar
            </button>
          </div>
        </div>

        {/* CEP multi-chip input */}
        <div className="mt-3">
          <p className="text-xs text-gray-500 mb-1.5">
            Busca por CEP <span className="text-gray-400">(até 30 — pressione Enter ou vírgula para adicionar)</span>
          </p>
          <div className="flex flex-wrap gap-1.5 min-h-[36px] items-center border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus-within:ring-2 focus-within:ring-green-500">
            {ceps.map(cep => (
              <span key={cep}
                className="inline-flex items-center gap-1 bg-green-50 border border-green-200 text-green-800 text-xs font-mono rounded px-2 py-0.5">
                {fmtCep(cep)}
                <button
                  type="button"
                  onClick={() => removeCep(cep)}
                  className="text-green-500 hover:text-green-700 leading-none ml-0.5"
                  aria-label={`Remover CEP ${fmtCep(cep)}`}
                >×</button>
              </span>
            ))}
            {ceps.length < 30 && (
              <input
                type="text"
                value={cepInput}
                onChange={e => setCepInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
                    e.preventDefault()
                    addCep(cepInput)
                  } else if (e.key === 'Backspace' && cepInput === '' && ceps.length > 0) {
                    setCeps(prev => prev.slice(0, -1))
                  }
                }}
                onBlur={() => { if (cepInput) addCep(cepInput) }}
                placeholder={ceps.length === 0 ? 'Ex: 22260003, 01310100...' : ''}
                maxLength={9}
                className="flex-1 min-w-[140px] outline-none text-sm font-mono placeholder:text-gray-400 py-0.5"
              />
            )}
            {ceps.length >= 30 && (
              <span className="text-xs text-gray-400 italic">Limite de 30 CEPs atingido</span>
            )}
          </div>
        </div>
      </form>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-gray-400 text-sm">Buscando clientes...</div>
        ) : customers.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-sm">Nenhum cliente encontrado.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <button onClick={() => handleSort('name')} className="flex items-center hover:text-gray-700 transition">
                      Nome<SortIcon col="name" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Contato</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Cidade</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <button onClick={() => handleSort('total_spent')} className="flex items-center ml-auto hover:text-gray-700 transition">
                      Acumulado Comprado<SortIcon col="total_spent" />
                    </button>
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <button onClick={() => handleSort('purchase_count')} className="flex items-center ml-auto hover:text-gray-700 transition">
                      Histórico de Compras<SortIcon col="purchase_count" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <button onClick={() => handleSort('last_purchase')} className="flex items-center hover:text-gray-700 transition">
                      Última Compra<SortIcon col="last_purchase" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <button onClick={() => handleSort('channel')} className="flex items-center hover:text-gray-700 transition">
                      Canal<SortIcon col="channel" />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {customers.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50 transition cursor-pointer"
                    onClick={() => router.push(`/clientes/${c.id}`)}>
                    <td className="px-4 py-3">
                      <span className="font-medium text-green-700 hover:underline">{c.full_name}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      <div>{c.email || '—'}</div>
                      <div className="text-xs">{c.phone || ''}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{c.city ? `${c.city}${c.state ? ` - ${c.state}` : ''}` : '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-800">{fmt(c.total_spent)}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{c.purchase_count}</td>
                    <td className="px-4 py-3 text-gray-500">{fmtDate(c.last_purchase_date)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        c.source_channel === 'wbuy' ? 'bg-blue-100 text-blue-700'
                        : c.source_channel === 'pdvnet' ? 'bg-orange-100 text-orange-700'
                        : c.source_channel === 'legacy' || c.source_channel === 'legacy_spreadsheet' ? 'bg-yellow-100 text-yellow-700'
                        : 'bg-purple-100 text-purple-700'
                      }`}>
                        {c.source_channel === 'wbuy' ? 'wBuy'
                          : c.source_channel === 'pdvnet' ? 'PDVNet'
                          : c.source_channel === 'legacy' || c.source_channel === 'legacy_spreadsheet' ? 'Planilha'
                          : 'Wix'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-500">
            <span>Página {page} de {totalPages}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition">
                ← Anterior
              </button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition">
                Próxima →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ClientesPage() {
  return (
    <Suspense>
      <ClientesContent />
    </Suspense>
  )
}
