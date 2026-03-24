"use client"

import { Bot, ChevronLeft, ChevronRight, HelpCircle, History, MessageSquare, Settings } from "lucide-react"
import { cn } from "@/lib/utils"

interface SidebarProps {
  isCollapsed: boolean
  onToggle: () => void
  activeMenu: string
  onMenuChange: (menu: string) => void
}

const menuItems = [
  { id: "chat", label: "채팅", icon: MessageSquare },
  { id: "history", label: "질문 이력", icon: History },
  { id: "faq", label: "FAQ", icon: HelpCircle },
  { id: "settings", label: "설정", icon: Settings },
]

export function Sidebar({ isCollapsed, onToggle, activeMenu, onMenuChange }: SidebarProps) {
  return (
    <aside
      className={cn(
        "relative flex h-full flex-col border-r border-border bg-card transition-all duration-300 ease-in-out",
        isCollapsed ? "w-16" : "w-64",
      )}
    >
      <div className="flex items-center gap-3 border-b border-border p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md">
          <Bot className="h-5 w-5" />
        </div>
        {!isCollapsed ? (
          <div className="flex flex-col overflow-hidden">
            <span className="truncate text-sm font-bold text-foreground">CoviAI</span>
            <span className="truncate text-xs text-muted-foreground">CS 유지보수 챗봇 프론트</span>
          </div>
        ) : null}
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {menuItems.map((item) => {
          const Icon = item.icon
          const isActive = activeMenu === item.id
          return (
            <button
              key={item.id}
              onClick={() => onMenuChange(item.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
              type="button"
            >
              <Icon className={cn("h-5 w-5 shrink-0", isActive && "text-primary-foreground")} />
              {!isCollapsed ? <span className="truncate">{item.label}</span> : null}
            </button>
          )
        })}
      </nav>

      <button
        onClick={onToggle}
        className="absolute -right-3 top-20 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card shadow-md transition-colors hover:bg-accent"
        type="button"
      >
        {isCollapsed ? (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      <div className="border-t border-border p-3">
        <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", isCollapsed && "justify-center")}>
          <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
          {!isCollapsed ? <span>AI Core 연결 테스트 중</span> : null}
        </div>
      </div>
    </aside>
  )
}
