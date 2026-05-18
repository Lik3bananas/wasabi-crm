'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

interface Item {
  product_name: string
  sku: string
  quantity: number
  unit_price: string
  total_price: string
}

interface Purchase {
  id: number
  purchase_date: string
  total_amount: string
  status: string
  source_channel: string
  customer_channel: string
  loja_nome: string | null
  vendedora_nome: string | null
  items: Item[]
}

interface CustomerDetail {
  customer: {
    id: string
    full_name: string
    source_channel: string
    total_spent: string
    purchase_count: number
    first_purchase_date: string
    last_purchase_date: string
    is_active: boolean
    created_at: string
    sibling_count: number
  }
  emails: { email: string; type: string; is_primary: boolean }[]
  phones: { phone: string; type: string; is_primary: boolean }[]
  addresses: { street: string; number: string; complement: string; city: string; state: string; zipcode: string; type: string; is_primary: boolean }[]
  purchases: Purchase[]
}

function fmt(val: string | number) {
  return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

const statusColor: Record<string, string> = {
  completed:  'bg-green-100 text-green-700',
  pending:    'bg-yellow-100 text-yellow-700',
  cancelled:  'bg-red-100 text-red-700',
  processing: 'bg-blue-100 text-blue-700',
}
const statusLabel: Record<string, string> = {
  completed:  'Concluído',
  pending:    'Pendente',
  cancelled:  'Cancelado',
  processing: 'Processando',
}

function channelLabel(ch: string) {
  if (ch === 'wbuy') return 'wBuy'
  if (ch === 'pdvnet') return 'Loja Física'
  if (ch === 'legacy' || ch === 'legacy_spreadsheet') return 'Wix'
  return 'Wix'
}
function channelClass(ch: string) {
  if (ch === 'wbuy') return 'bg-blue-100 text-blue-700'
  if (ch === 'pdvnet') return 'bg-orange-100 text-orange-700'
  if (ch === 'legacy' || ch === 'legacy_spreadsheet') return 'bg-yellow-100 text-yellow-700'
  return 'bg-purple-100 text-purple-700'
}
function ChannelBadge({ channel }: { channel: string }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${channelClass(channel)}`}>
      {channelLabel(channel)}
    </span>
  )
}

export default function CustomerProfilePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [data, setData] = useState<CustomerDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [openPurchase, setOpenPurchase] = useState<number | null>(null)

  useEffect(() => {
    fetch(`/api/customers/${id}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="text-gray-400 text-sm">Carregando perfil...</div>
  if (!data) return <div className="text-red-500 text-sm">Cliente não encontrado.</div>

  const { customer, emails, phones, addresses, purchases } = data

  // Canal da última compra (purchases já vêm ordenados por data DESC)
  const lastChannel = purchases.length > 0
    ? (purchases[0].source_channel || purchases[0].customer_channel || customer.source_channel)
    : customer.source_channel

  const totalRevenue = purchases
    .filter(p => p.status !== 'cancelled')
    .reduce((s, p) => s + Number(p.total_amount), 0)

  const totalItems = purchases
    .filter(p => p.status !== 'cancelled')
    .reduce((s, p) => s + (p.items || []).reduce((si, i) => si + i.quantity, 0), 0)

  return (
    <div>
      <button onClick={() => router.back()} className="text-sm text-green-600 hover:underline mb-5 flex items-center gap-1">
        ← Voltar para clientes
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{customer.full_name}</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <ChannelBadge channel={lastChannel} />
            {customer.sibling_count > 1 && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-yellow-100 text-yellow-700">
                {customer.sibling_count} registros unificados
              </span>
            )}
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-400 mb-1">Acumulado Comprado</p>
          <p className="text-xl font-bold text-green-700">{fmt(customer.total_spent)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-400 mb-1">Histórico de Compras</p>
          <p className="text-xl font-bold text-gray-800">{customer.purchase_count}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-400 mb-1">Itens Comprados</p>
          <p className="text-xl font-bold text-gray-800">{totalItems}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-400 mb-1">Ticket Médio</p>
          <p className="text-xl font-bold text-gray-800">
            {customer.purchase_count > 0 ? fmt(totalRevenue / customer.purchase_count) : '—'}
          </p>
        </div>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">

        {/* Resumo */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Resumo</h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-gray-400">Primeira Compra</span><span>{fmtDate(customer.first_purchase_date)}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Última Compra</span><span className="font-medium">{fmtDate(customer.last_purchase_date)}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Cliente desde</span><span>{fmtDate(customer.created_at)}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">ID</span><span className="text-xs text-gray-400 font-mono">{customer.id}</span></div>
          </div>
        </div>

        {/* Contatos */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Contatos</h2>
          {emails.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-gray-400 mb-1">E-mails</p>
              {emails.map((e, i) => (
                <p key={i} className="text-sm break-all">
                  {e.email}
                  {e.is_primary && <span className="ml-1 text-xs text-green-600">(principal)</span>}
                </p>
              ))}
            </div>
          )}
          {phones.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-1">Telefones</p>
              {phones.map((p, i) => (
                <p key={i} className="text-sm">
                  {p.phone}
                  {p.is_primary && <span className="ml-1 text-xs text-green-600">(principal)</span>}
                </p>
              ))}
            </div>
          )}
          {emails.length === 0 && phones.length === 0 && (
            <p className="text-sm text-gray-400">Sem contatos cadastrados.</p>
          )}
        </div>

        {/* Endereços */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Endereços</h2>
          {addresses.length === 0 ? (
            <p className="text-sm text-gray-400">Sem endereços cadastrados.</p>
          ) : addresses.map((a, i) => (
            <div key={i} className={`text-sm mb-3 ${i > 0 ? 'border-t border-gray-50 pt-3' : ''}`}>
              {a.street && <p className="font-medium">{a.street}{a.number ? `, ${a.number}` : ''}{a.complement ? ` - ${a.complement}` : ''}</p>}
              <p className="text-gray-500">{a.city}{a.state ? ` - ${a.state}` : ''}{a.zipcode ? ` | CEP ${a.zipcode}` : ''}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Histórico de Compras */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700">
            Histórico de Compras ({purchases.length})
          </h2>
          <span className="text-sm font-bold text-green-700">{fmt(totalRevenue)} em compras</span>
        </div>

        {purchases.length === 0 ? (
          <p className="text-sm text-gray-400">Nenhum pedido encontrado.</p>
        ) : (
          <div className="space-y-2">
            {purchases.map((p) => (
              <div key={p.id} className="border border-gray-100 rounded-lg overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-gray-50 transition"
                  onClick={() => setOpenPurchase(openPurchase === p.id ? null : p.id)}
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-gray-400 text-xs font-mono">#{p.id}</span>
                    <span className="text-gray-600">{fmtDate(p.purchase_date)}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[p.status] || 'bg-gray-100 text-gray-600'}`}>
                      {statusLabel[p.status] || p.status}
                    </span>
                    <ChannelBadge channel={p.source_channel || p.customer_channel} />
                    {p.loja_nome && (
                      <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                        🏪 {p.loja_nome}
                      </span>
                    )}
                    {p.vendedora_nome && (
                      <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                        👤 {p.vendedora_nome}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-green-700">{fmt(p.total_amount)}</span>
                    <span className="text-gray-400 text-xs">{openPurchase === p.id ? '▲' : '▼'}</span>
                  </div>
                </button>

                {openPurchase === p.id && (
                  <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
                    {(p.items || []).length === 0 ? (
                      <p className="text-xs text-gray-400">Sem itens registrados.</p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-400 border-b border-gray-100">
                            <th className="text-left pb-2">Produto</th>
                            <th className="text-left pb-2">SKU</th>
                            <th className="text-right pb-2">Qtd</th>
                            <th className="text-right pb-2">Unitário</th>
                            <th className="text-right pb-2">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(p.items || []).map((item, i) => (
                            <tr key={i} className="border-b border-gray-50 last:border-0">
                              <td className="py-1.5 text-gray-700 pr-3">{item.product_name}</td>
                              <td className="py-1.5 text-gray-400 font-mono pr-3">{item.sku || '—'}</td>
                              <td className="py-1.5 text-right pr-3">{item.quantity}</td>
                              <td className="py-1.5 text-right pr-3">{fmt(item.unit_price)}</td>
                              <td className="py-1.5 text-right font-medium">{fmt(item.total_price)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          {(() => {
                            const itemsSum = (p.items || []).reduce((s, i) => s + Number(i.total_price), 0)
                            const paid = Number(p.total_amount)
                            const discount = itemsSum - paid
                            return (
                              <>
                                {discount > 0.01 && (
                                  <>
                                    <tr>
                                      <td colSpan={4} className="pt-2 text-right text-gray-400">Subtotal</td>
                                      <td className="pt-2 text-right text-gray-500">{fmt(itemsSum)}</td>
                                    </tr>
                                    <tr>
                                      <td colSpan={4} className="text-right text-red-500">Desconto</td>
                                      <td className="text-right text-red-500 font-medium">-{fmt(discount)}</td>
                                    </tr>
                                  </>
                                )}
                                <tr className="border-t border-gray-200">
                                  <td colSpan={4} className="pt-2 text-right text-gray-500 font-medium">Total pago</td>
                                  <td className="pt-2 text-right font-bold text-green-700">{fmt(p.total_amount)}</td>
                                </tr>
                              </>
                            )
                          })()}
                        </tfoot>
                      </table>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
