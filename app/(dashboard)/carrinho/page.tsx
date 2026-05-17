'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Product {
  name: string
  sku: string | null
  qty: number
  price: number
  color: string | null
  variation: string | null
}

interface ExistingCustomer {
  id: string
  full_name: string
  email: string
  phone: string
  total_spent: string
  purchase_count: number
  last_purchase_date: string
  source_channel: string
}

interface Cart {
  wbuy_order_id: number
  wbuy_order_code: string
  date: string
  status_label: string
  total: number
  customer_name: string
  customer_email: string | null
  customer_phone: string | null
  customer_city: string | null
  customer_state: string | null
  payment_method: string | null
  products: Product[]
  existing_customer: ExistingCustomer | null
  // local UI state
  _profileCreated?: boolean
  _createdCustomerId?: string
}

function fmt(v: string | number) {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

export default function CarrinhoPage() {
  const router = useRouter()
  const [carts, setCarts]         = useState<Cart[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [expanded, setExpanded]   = useState<Set<number>>(new Set())
  const [creating, setCreating]   = useState<Set<number>>(new Set())

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/abandoned-carts')
      if (!res.ok) throw new Error('Falha ao buscar carrinhos')
      const data = await res.json()
      setCarts(data.carts || [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function toggleExpanded(id: number) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function createProfile(cart: Cart) {
    setCreating(prev => new Set(prev).add(cart.wbuy_order_id))
    try {
      const res = await fetch('/api/abandoned-carts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name:  cart.customer_name,
          customer_email: cart.customer_email,
          customer_phone: cart.customer_phone,
          wbuy_order_id:  cart.wbuy_order_id,
          date:           cart.date,
          total:          cart.total,
          products:       cart.products,
          status_label:   cart.status_label,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro')

      setCarts(prev =>
        prev.map(c =>
          c.wbuy_order_id === cart.wbuy_order_id
            ? { ...c, _profileCreated: true, _createdCustomerId: data.customer_id }
            : c
        )
      )
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Erro ao criar perfil')
    } finally {
      setCreating(prev => {
        const next = new Set(prev)
        next.delete(cart.wbuy_order_id)
        return next
      })
    }
  }

  const totalValue    = carts.reduce((s, c) => s + c.total, 0)
  const newCustomers  = carts.filter(c => !c.existing_customer).length
  const existingCount = carts.filter(c =>  c.existing_customer).length

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Carrinhos Abandonados</h1>
          <p className="text-gray-500 text-sm mt-1">Últimos 30 dias — Aguardando pagamento e Pagamento negado (wBuy)</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 text-sm bg-white border border-gray-200 hover:border-green-400 text-gray-600 hover:text-green-700 px-4 py-2 rounded-lg transition disabled:opacity-50"
        >
          <span className={loading ? 'animate-spin' : ''}>↻</span>
          Atualizar
        </button>
      </div>

      {/* Stats */}
      {!loading && !error && carts.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-400 mb-1">Total de carrinhos</p>
            <p className="text-xl font-bold text-gray-800">{carts.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-400 mb-1">Valor em risco</p>
            <p className="text-xl font-bold text-green-700">{fmt(totalValue)}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-400 mb-1">Clientes existentes</p>
            <p className="text-xl font-bold text-blue-700">{existingCount}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-400 mb-1">Clientes novos</p>
            <p className="text-xl font-bold text-orange-600">{newCustomers}</p>
          </div>
        </div>
      )}

      {/* States */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-sm">Buscando carrinhos na wBuy...</p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-red-700 font-medium">{error}</p>
          <button onClick={load} className="mt-3 text-sm text-red-600 underline">Tentar novamente</button>
        </div>
      )}

      {!loading && !error && carts.length === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-10 text-center">
          <p className="text-3xl mb-3">🎉</p>
          <p className="font-semibold text-green-800 text-lg">Nenhum carrinho abandonado nos últimos 30 dias</p>
          <p className="text-green-600 text-sm mt-1">Todos os pedidos foram concluídos.</p>
        </div>
      )}

      {/* Cart list */}
      {!loading && !error && carts.length > 0 && (
        <div className="space-y-4">
          {carts.map((cart) => {
            const isOpen    = expanded.has(cart.wbuy_order_id)
            const isCreating = creating.has(cart.wbuy_order_id)
            const isNew     = !cart.existing_customer
            const profileDone = cart._profileCreated

            return (
              <div
                key={cart.wbuy_order_id}
                className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden"
              >
                {/* Card header */}
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    {/* Left: customer info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-semibold text-gray-800 text-base">{cart.customer_name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          cart.status_label === 'Aguardando pagamento'
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-red-100 text-red-700'
                        }`}>
                          {cart.status_label}
                        </span>
                        {cart.payment_method && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                            {cart.payment_method}
                          </span>
                        )}
                      </div>

                      <div className="text-sm text-gray-500 space-y-0.5">
                        {cart.customer_email && <p>✉ {cart.customer_email}</p>}
                        {cart.customer_phone && <p>📱 {cart.customer_phone}</p>}
                        {cart.customer_city  && (
                          <p>📍 {cart.customer_city}{cart.customer_state ? ` - ${cart.customer_state}` : ''}</p>
                        )}
                        <p className="text-xs text-gray-400">
                          #{cart.wbuy_order_code} · {fmtDate(cart.date)}
                        </p>
                      </div>
                    </div>

                    {/* Right: value + customer status */}
                    <div className="text-right flex-shrink-0">
                      <p className="text-lg font-bold text-green-700">{fmt(cart.total)}</p>
                      <p className="text-xs text-gray-400 mb-2">{cart.products.length} produto(s)</p>

                      {/* Customer match status */}
                      {cart.existing_customer ? (
                        <div className="space-y-1">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                            Cliente existente
                          </span>
                          <div className="text-xs text-gray-400 mt-1">
                            <p>{fmt(cart.existing_customer.total_spent)} em compras</p>
                            <p>{cart.existing_customer.purchase_count} pedido(s)</p>
                          </div>
                          <button
                            onClick={() => router.push(`/clientes/${cart.existing_customer!.id}`)}
                            className="mt-2 text-xs text-blue-600 hover:underline font-medium block"
                          >
                            Ver perfil completo →
                          </button>
                        </div>
                      ) : profileDone ? (
                        <div className="space-y-1">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                            Perfil criado ✓
                          </span>
                          <button
                            onClick={() => router.push(`/clientes/${cart._createdCustomerId}`)}
                            className="mt-2 text-xs text-green-600 hover:underline font-medium block"
                          >
                            Ver perfil →
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">
                            Cliente novo
                          </span>
                          <button
                            onClick={() => createProfile(cart)}
                            disabled={isCreating}
                            className="mt-2 text-xs bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 rounded-lg font-medium transition disabled:opacity-50 block w-full"
                          >
                            {isCreating ? 'Criando...' : 'Criar Perfil'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Toggle products */}
                  <button
                    onClick={() => toggleExpanded(cart.wbuy_order_id)}
                    className="mt-3 text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 transition"
                  >
                    {isOpen ? '▲ Ocultar produtos' : '▼ Ver produtos'}
                  </button>
                </div>

                {/* Products table */}
                {isOpen && (
                  <div className="border-t border-gray-100 bg-gray-50 px-5 py-4">
                    {cart.products.length === 0 ? (
                      <p className="text-xs text-gray-400">Sem produtos registrados.</p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-400 border-b border-gray-200">
                            <th className="text-left pb-2">Produto</th>
                            <th className="text-left pb-2">SKU</th>
                            <th className="text-left pb-2">Variação</th>
                            <th className="text-right pb-2">Qtd</th>
                            <th className="text-right pb-2">Unitário</th>
                            <th className="text-right pb-2">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cart.products.map((p, i) => (
                            <tr key={i} className="border-b border-gray-100 last:border-0">
                              <td className="py-1.5 text-gray-700 pr-3 font-medium">{p.name}</td>
                              <td className="py-1.5 text-gray-400 font-mono pr-3">{p.sku || '—'}</td>
                              <td className="py-1.5 text-gray-500 pr-3">
                                {[p.color, p.variation].filter(Boolean).join(' / ') || '—'}
                              </td>
                              <td className="py-1.5 text-right pr-3">{p.qty}</td>
                              <td className="py-1.5 text-right pr-3">{fmt(p.price)}</td>
                              <td className="py-1.5 text-right font-semibold text-green-700">{fmt(p.qty * p.price)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-gray-200">
                            <td colSpan={5} className="pt-2 text-right text-gray-500 font-medium">Total do carrinho</td>
                            <td className="pt-2 text-right font-bold text-green-700">{fmt(cart.total)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
