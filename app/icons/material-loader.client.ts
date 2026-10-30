import type { Component } from 'vue'
const groups = [
  () => import('./material-groups/g0'),
  () => import('./material-groups/g1'),
  () => import('./material-groups/g2'),
  () => import('./material-groups/g3'),
  () => import('./material-groups/g4'),
  () => import('./material-groups/g5'),
  () => import('./material-groups/g6'),
  () => import('./material-groups/g7'),
  () => import('./material-groups/g8'),
  () => import('./material-groups/g9'),
  () => import('./material-groups/g10'),
  () => import('./material-groups/g11'),
  () => import('./material-groups/g12'),
  () => import('./material-groups/g13'),
  () => import('./material-groups/g14'),
  () => import('./material-groups/g15'),
]
export async function loadMaterialIcon(name: string): Promise<Component> {
  let hash = 0
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0
  const icons = await groups[hash % groups.length]!()
  return (icons as Record<string, Component>)[name]!
}
