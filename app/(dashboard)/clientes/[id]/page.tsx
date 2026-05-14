'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

interface CustomerDetail {
  customer: {
    id: number; full_name: string; source_channel: string
    total_spent: string; purchase_count: number
    first_purchase_date: string; last_purchase_date: string
    is_active: boolean; created_at: string
  }
  emails: { email: string; type: string; is_primary: boolean }[]
  phones: { phone: string; type: string; is_primary: boolean }[]
  addresses: { street: string; number: string; complement: string; city: string; state: string; zipcode: string; type: string; is_primary: boolean }[]
  purchases: {
    id: number; purchase_date: string; total_amount: string; status: string; source_channel: string
    items: { product_name: string; quantity: number; unit_price: string; total_price: string }[]
  }[]
}

function fmt(val: string | number) {
  return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('pt-BR')
}

const statusColor: Record<string, string> = {
  concluido: 'bg-green-100 text-green-700',
  pendente: 'bg-yellow-100 text-yellow-700',
  cancelado: 'bg-red-100 text-red-700',
  processando: 'bg-blue-100 text-blue-700',
}

export default function CustomerProfilePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [data, setData] = useState<CustomerDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [openPurchase, setOpenPurchase] = useState<number | null>(null)

  useEffect(() => {
    fetch(`/api/customers/${id}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="text-gray-400 text-sm">Carregando perfil...</div>
  if (!data) return <div className="text-red-500 text-sm">Cliente não encontrado.</div>

  const { customer, emails, phones, addresses, purchases } = data

  return (
    <div>
      <button onClick={() => router.back()} className="text-sm text-green-600 hover:underline mb-5 flex items-center gap-1">
        ← Voltar para clientes
      </button>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{customer.full_name}</h1>
          <div className="flex items-center gap-3 mt-1">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              customer.source_channel === 'wbuy' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
            }`}>
              {customer.source_channel === 'wbuy' ? 'wBuy' : 'Legado'}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              customer.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
            }`}>
              {customer.is_active ? 'Ativo' : 'Inativo'}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Resumo</h2>
          <div className="space-y-3">
            <div><p className="text-xs text-gray-400">Total Gasto</p><p className="font-bold text-lg text-green-700">{fmt(customer.total_spent)}</p></div>
            <div><p className="text-xs text-gray-400">Pedidos</p><p className="font-semibold">{customer.purchase_count}</p></div>
            <div><p className="text-xs text-gray-400">Primeira Compra</p><p className="text-sm">{fmtDate(customer.first_purchase_date)}</p></div>
            <div><p className="text-xs text-gray-400">Última Compra</p><p className="text-sm">{fmtDate(customer.last_purchase_date)}</p></div>
            <div><p className="text-xs text-gray-400">Cliente desde</p><p className="text-sm">{fmtDate(customer.created_at)}</p></div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Contatos</h2>
          {emails.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-gray-400 mb-1">E-mails</p>
              {emails.map((e, i) => (
                <p key={i} className="text-sm">{e.email}
                  {e.is_primary && <span className="ml-1 text-xs text-green-600">(principal)</span>}
                </p>
              ))}
            </div>
          )}
          {phones.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-1">Telefones</p>
              {phones.map((p, i) => (
                <p key={i} className="text-sm">{p.phone} <span className="text-xs text-gray-400">{p.type}</span>
                  {p.is_primary && <span className="ml-1 text-xs text-green-600">(principal)</span>}
                </p>
              ))}
            </div>
          )}
          {emails.length === 0 && phones.length === 0 && <p className="text-sm text-gray-400">Sem contatos cadastrados.</p>}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Endereços</h2>
          {addresses.length === 0 ? (
            <p className="text-sm text-gray-400">Sem endereços cadastrados.</p>
          ) : addresses.map((a, i) => (
            <div key={i} className={`text-sm mb-3 ${i > 0 ? 'border-t border-gray-50 pt-3' : ''}`}>
              <p className="font-medium">{a.street}{a.number ? `, ${a.number}` : ''}{a.complement ? ` - ${a.complement}` : ''}</p>
              <p className="text-gray-500">{a.city}{a.state ? ` - ${a.state}` : ''}{a.zipcode ? ` | CEP ${a.zipcode}` : ''}</p>
              <span className="text-xs text-gray-400">{a.type}{a.is_primary ? ' · principal' : ''}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Histórico de Pedidos ({purchases.length})</h2>
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
                  <div className="flex items-center gap-4">
                    <span className="text-gray-400 text-xs">#{p.id}</span>
                    <span>{fmtDate(p.purchase_date)}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[p.status] || 'bg-gray-100 text-gray-600'}`}>
                      {p.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-semibold text-green-700">{fmt(p.total_amount)}</span>
                    <span className="text-gray-400">{openPurchase === p.id ? '▲' : '▼'}</span>
                  </div>
                </button>
                {openPurchase === p.id && (
                  <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
                    <table className="w-full text-xs">
                      <thead><tr className="text-gray-400">
                        <th className="text-left pb-1">Produto</th>
                        <th className="text-right pb-1">Qtd</th>
                        <th className="text-right pb-1">Unitário</th>
                        <th className="text-right pb-1">Total</th>
                      </tr></thead>
                      <tbody>{(p.items || []).map((item, i) => (
                        <tr key={i}>
                          <td className="py-0.5 text-gray-700">{item.product_name}</td>
                          <td className="text-right">{item.quantity}</td>
                          <td className="text-right">{fmt(item.unit_price)}</td>
                          <td className="text-right font-medium">{fmt(item.total_price)}</td>
                        </tr>
                      ))}</tbody>
                    </table>
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
