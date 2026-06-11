import { NavLink, useNavigate } from 'react-router-dom'
import { Server, Users, LayoutDashboard, LogOut, Cpu } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '../../hooks/useAuth'

export default function Sidebar() {
  const { logout, user } = useAuth()
  const navigate = useNavigate()

  const navItems = [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/clients', icon: Users, label: 'Clientes' },
    ...(user?.role === 'superadmin'
      ? [{ to: '/firmware', icon: Cpu, label: 'Firmware OTA' }]
      : []),
  ]

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <aside className="w-60 bg-gray-900 border-r border-gray-800 flex flex-col h-screen fixed left-0 top-0">
      <div className="p-5 flex items-center gap-3 border-b border-gray-800">
        <div className="p-2 bg-blue-600 rounded-lg">
          <Server className="w-5 h-5 text-white" />
        </div>
        <span className="font-bold text-white text-sm">CPD Monitor</span>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-blue-600/20 text-blue-400'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800',
              )
            }
          >
            <Icon className="w-4 h-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 border-t border-gray-800">
        <div className="px-3 py-2 text-xs text-gray-500 mb-1">{user?.role}</div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-colors w-full"
        >
          <LogOut className="w-4 h-4" />
          Sair
        </button>
      </div>
    </aside>
  )
}
