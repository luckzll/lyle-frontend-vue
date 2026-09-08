export interface CaptchaOptions { provider: string; configured: boolean }
export interface CaptchaProof { captchaToken: string }
export interface CaptchaImage {
  id: string
  backgroundImageTag?: string
  backgroundImage: string
  templateImage: string
  backgroundImageWidth: number
  backgroundImageHeight: number
  templateImageWidth: number
  templateImageHeight: number
}
export interface CaptchaPoint { x: number; y: number; t: number; type: string }
export function safeCaptchaImage(src: string): boolean {
  return /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(src)
}
