package app.kilometr.predictiveback

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.graphics.Outline
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.view.animation.DecelerateInterpolator
import androidx.activity.BackEventCompat
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.swmansion.rnscreens.Screen
import com.swmansion.rnscreens.ScreenStack

class PredictiveBackController(val activity: ComponentActivity) : OnBackPressedCallback(false) {
    private var navigationEnabled = false
    private var preview: BackPreview? = null
    private var animator: ValueAnimator? = null

    fun setNavigationEnabled(enabled: Boolean) {
        navigationEnabled = enabled
        isEnabled = enabled
        if (!enabled) cancelPreview()
    }

    override fun handleOnBackStarted(backEvent: BackEventCompat) {
        if (preview?.committing == true) return
        cancelPreview()
        val root = activity.window.decorView
        if (ViewCompat.getRootWindowInsets(root)?.isVisible(WindowInsetsCompat.Type.ime()) == true) return
        val stack = findBackStack(root) ?: return
        val top = stack.fragments.last()
        val previous = stack.fragments[stack.fragments.lastIndex - 1]
        if (top.fragment.parentFragmentManager.isStateSaved || top.fragment.view?.animation != null) return

        val attachedBelow = !previous.fragment.isAdded
        // Te same operacje udostępnia react-native-screens dla interaktywnych przejść.
        if (attachedBelow) stack.attachBelowTop()
        val view = top.fragment.view ?: run {
            if (attachedBelow) stack.detachBelowTop()
            return
        }
        preview = BackPreview(
            stack, top.screen, previous.screen, view, attachedBelow,
            if (backEvent.swipeEdge == BackEventCompat.EDGE_LEFT) 1f else -1f,
        )
    }

    override fun handleOnBackProgressed(backEvent: BackEventCompat) {
        preview?.takeUnless { it.committing }?.update(backEvent.progress)
    }

    override fun handleOnBackCancelled() {
        if (preview?.committing == true) return
        animateTo(0f) { cancelPreview() }
    }

    override fun handleOnBackPressed() {
        val current = preview
        if (current == null) {
            forwardBack()
            return
        }
        if (current.committing) return
        current.committing = true
        animateTo(1f) {
            // BackHandler nadal rozstrzyga zamykanie paneli i zmianę ekranu.
            current.top.stackAnimation = Screen.StackAnimation.NONE
            current.view.addOnAttachStateChangeListener(current)
            current.view.postDelayed(current.cleanup, 500)
            forwardBack()
        }
    }

    private fun forwardBack() {
        isEnabled = false
        activity.onBackPressedDispatcher.onBackPressed()
        isEnabled = navigationEnabled
    }

    private fun animateTo(target: Float, onEnd: () -> Unit) {
        val current = preview ?: return
        animator?.removeAllListeners()
        animator?.cancel()
        val startProgress = current.progress
        animator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 180
            interpolator = DecelerateInterpolator()
            addUpdateListener {
                val fraction = it.animatedValue as Float
                current.update(startProgress + (target - startProgress) * fraction)
                if (target == 1f) current.fadeOut(fraction)
            }
            addListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) {
                    animator = null
                    onEnd()
                }
            })
            start()
        }
    }

    fun cancelPreview() {
        animator?.removeAllListeners()
        animator?.cancel()
        animator = null
        preview?.restore()
        preview = null
    }

    private fun findBackStack(view: View): ScreenStack? {
        if (view is ScreenStack) {
            val top = view.topScreen ?: return null
            findBackStack(top)?.let { return it }
            return view.takeIf { it.fragments.size > 1 && it.fragments.last().screen === top }
        }
        if (view is ViewGroup) {
            for (index in view.childCount - 1 downTo 0) {
                val child = view.getChildAt(index)
                if (child.visibility != View.VISIBLE) continue
                findBackStack(child)?.let { return it }
            }
        }
        return null
    }

    private inner class BackPreview(
        val stack: ScreenStack,
        val top: Screen,
        private val previous: Screen,
        val view: View,
        private val attachedBelow: Boolean,
        private val direction: Float,
    ) : View.OnAttachStateChangeListener {
        var progress = 0f
        var committing = false
        private val originalScaleX = view.scaleX
        private val originalScaleY = view.scaleY
        private val originalTranslationX = view.translationX
        private val originalAlpha = view.alpha
        private val originalClip = view.clipToOutline
        private val originalOutline = view.outlineProvider
        private val originalAnimation = top.stackAnimation
        private val originalAccessibility = previous.importantForAccessibility
        val cleanup = Runnable { if (preview === this) cancelPreview() }

        init {
            previous.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            view.clipToOutline = true
            view.outlineProvider = object : ViewOutlineProvider() {
                override fun getOutline(view: View, outline: Outline) {
                    outline.setRoundRect(
                        0, 0, view.width, view.height,
                        28f * view.resources.displayMetrics.density * progress,
                    )
                }
            }
        }

        fun update(value: Float) {
            progress = value.coerceIn(0f, 1f)
            view.scaleX = originalScaleX * (1f - 0.1f * progress)
            view.scaleY = originalScaleY * (1f - 0.1f * progress)
            view.translationX = originalTranslationX + direction * view.width * 0.05f * progress
            view.invalidateOutline()
        }

        fun restore() {
            view.removeCallbacks(cleanup)
            view.removeOnAttachStateChangeListener(this)
            view.scaleX = originalScaleX
            view.scaleY = originalScaleY
            view.translationX = originalTranslationX
            view.alpha = originalAlpha
            view.clipToOutline = originalClip
            view.outlineProvider = originalOutline
            top.stackAnimation = originalAnimation
            previous.importantForAccessibility = if (stack.topScreen === previous) {
                View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
            } else {
                originalAccessibility
            }
            if (attachedBelow && stack.topScreen === top &&
                stack.fragments.getOrNull(stack.fragments.lastIndex - 1)?.screen === previous &&
                previous.fragment?.isAdded == true && !activity.isDestroyed) {
                stack.detachBelowTop()
            }
        }

        fun fadeOut(fraction: Float) {
            view.alpha = originalAlpha * (1f - fraction)
        }

        override fun onViewAttachedToWindow(view: View) = Unit

        override fun onViewDetachedFromWindow(view: View) {
            cleanup.run()
        }
    }
}
