import { useEffect, useState } from "react"

interface UseTypingEffectOptions {
  text: string
  speed?: number
  enabled?: boolean
}

/**
 * 타이핑 효과를 위한 커스텀 훅
 * 텍스트 길이에 따라 속도 자동 조절
 */
export function useTypingEffect({ text, speed = 8, enabled = true }: UseTypingEffectOptions) {
  const [displayedText, setDisplayedText] = useState("")
  const [isComplete, setIsComplete] = useState(false)

  useEffect(() => {
    // 타이핑 효과가 비활성화되면 전체 텍스트를 즉시 표시
    if (!enabled) {
      setDisplayedText(text)
      setIsComplete(true)
      return
    }

    // 텍스트가 변경되면 초기화
    setDisplayedText("")
    setIsComplete(false)

    if (text.length === 0) {
      setIsComplete(true)
      return
    }

    // 텍스트 길이에 따라 속도 자동 조절
    // 짧은 텍스트(< 100자): 느리게 (8ms)
    // 중간 텍스트(100-500자): 보통 (5ms)
    // 긴 텍스트(> 500자): 빠르게 (2ms)
    let adjustedSpeed = speed
    if (text.length > 500) {
      adjustedSpeed = Math.min(speed, 2) // 최대 2ms (빠르게)
    } else if (text.length > 100) {
      adjustedSpeed = Math.min(speed, 5) // 최대 5ms (보통)
    }

    let index = 0
    const intervalId = setInterval(() => {
      if (index >= text.length) {
        setIsComplete(true)
        clearInterval(intervalId)
        return
      }

      setDisplayedText((prev) => prev + text[index])
      index += 1
    }, adjustedSpeed)

    return () => clearInterval(intervalId)
  }, [text, speed, enabled])

  return { displayedText, isComplete }
}
