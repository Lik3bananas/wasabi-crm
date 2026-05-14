'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

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
}

function fmt(val: string | number) {
  return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('pt-BR')
}

export default function CarrinhoPage() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<Customer[]>([])
  const [searched, setSearched] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!search.trim()) return
    setLoading(true)
    setSearched(false)

    const res = await fetch(`/api/customers?search=${encodeURIComponent(search)}&page=1`)
    const data = await res.json()
    setResults(data.customers || [])
    setSearched(true)
    setLoading(false)
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Carrinho Abandonado</h1>
        <p className="text-gray-500 text-sm mt-1">
          Digite o nome, e-mail ou telefone do visitante para verificar se já é cliente.
        </p>
      </div>

      <form onSubmit={handleSearch} className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">Identificar cliente</label>
        <div className="flex gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ex: João Silva, joao@email.com ou (11) 99999-9999"
            className="flex-1 border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <button
            type="submit"
            disabled={loading || !search.trim()}
            className="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition disabled:opacity-50"
          >
            {loading ? 'Buscando...' : 'Buscar'}
          </button>
        </div>
      </form>

      {searched && (
        <div>
          {results.length === 0 ? (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-center">
              <p className="text-2xl mb-2">🆕</p>
              <p className="font-semibold text-yellow-800">Cliente não encontrado na base</p>
              <p className="text-yellow-700 text-sm mt-1">
                Este visitante não possui histórico. É uma oportunidade de aquisição de novo cliente.
              </p>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-green-600 text-lg">✅</span>
                <p className="font-semibold text-gray-800">
                  {results.length === 1 ? '1 cliente encontrado' : `${results.length} clientes encontrados`}
                </p>
              </div>
              <div className="space-y-3">
                {results.map((c) => (
                  <div
                    key={c.id}
                    className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 cursor-pointer hover:border-green-300 hover:shadow-md transition"
                    onClick={() => router.push(`/clientes/${c.id}`)}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-green-700 text-base">{c.full_name}</p>
                        <div className="text-sm text-gray-500 mt-1 space-y-0.5">
                          {c.email && <p>✉️ {c.email}</p>}
                          {c.phone && <p>📱 {c.phone}</p>}
                          {c.city && <p>📍 {c.city}{c.state ? ` - ${c.state}` : ''}</p>}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-green-700">{fmt(c.total_spent)}</p>
                        <p className="text-xs text-gray-400">{c.purchase_count} pedido(s)</p>
                        <p className="text-xs text-gray-400 mt-1">Última compra: {fmtDate(c.last_purchase_date)}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium mt-2 inline-block ${
                          c.source_channel === 'wbuy' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {c.source_channel === 'wbuy' ? 'wBuy' : 'Legado'}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-green-600 mt-3 font-medium">Clique para ver perfil completo →</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
