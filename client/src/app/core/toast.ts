import { Injectable } from '@angular/core';
import $ from 'jquery';

/** Lightweight toast notifications built with jQuery (DOM + fade animations). */
@Injectable({ providedIn: 'root' })
export class Toast {
  show(message: string, kind: 'ok' | 'error' = 'ok'): void {
    let $stack = $('#toast-stack');
    if (!$stack.length) {
      $stack = $('<div id="toast-stack" class="toast-stack" role="status" aria-live="polite"></div>').appendTo('body');
    }
    const $t = $('<div class="toast"></div>').addClass(kind).text(message).hide().appendTo($stack).fadeIn(150);
    $t.on('click', () => $t.stop().fadeOut(150, () => $t.remove()));
    setTimeout(() => $t.fadeOut(300, () => $t.remove()), kind === 'error' ? 6000 : 3500);
  }
  ok(message: string): void { this.show(message, 'ok'); }
  error(message: string): void { this.show(message, 'error'); }
}
