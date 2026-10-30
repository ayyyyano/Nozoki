declare module 'vue' {
  export interface GlobalComponents {
    VarSelect: (typeof import('@varlet/ui'))['Select']
    VarOption: (typeof import('@varlet/ui'))['Option']
    VarSlider: (typeof import('@varlet/ui'))['Slider']
    VarPopup: (typeof import('@varlet/ui'))['Popup']
    VarInput: (typeof import('@varlet/ui'))['Input']
    VarButton: (typeof import('@varlet/ui'))['Button']
    VarChip: (typeof import('@varlet/ui'))['Chip']
    VarProgress: (typeof import('@varlet/ui'))['Progress']
    VarSwitch: (typeof import('@varlet/ui'))['Switch']
  }
}
export {}
