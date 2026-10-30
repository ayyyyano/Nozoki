import {
  Button,
  Chip,
  Progress,
  Switch,
  Select,
  Option,
  Slider,
  Popup,
  Input,
  Menu,
} from '@varlet/ui'
import '@varlet/ui/es/select/style/index'
import '@varlet/ui/es/option/style/index'
import '@varlet/ui/es/slider/style/index'
import '@varlet/ui/es/popup/style/index'
import '@varlet/ui/es/input/style/index'
import '@varlet/ui/es/button/style/index'
import '@varlet/ui/es/chip/style/index'
import '@varlet/ui/es/progress/style/index'
import '@varlet/ui/es/switch/style/index'
import '@varlet/ui/es/menu/style/index'

export default defineNuxtPlugin((nuxt) => {
  for (const [name, component] of Object.entries({
    VarSelect: Select,
    VarOption: Option,
    VarSlider: Slider,
    VarPopup: Popup,
    VarInput: Input,
    VarButton: Button,
    VarChip: Chip,
    VarProgress: Progress,
    VarSwitch: Switch,
    VarMenu: Menu,
  })) {
    nuxt.vueApp.component(name, component)
  }
})
