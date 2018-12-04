<stripe-payment>
  <a href="#!">
    <i class="fa fa-times text-danger mr-3" if={ !opts.order.invoice.paid } />
    <i class="fa fa-check text-success mr-3" if={ opts.order.invoice.paid } />
    { this.t ('stripe.order.' + (opts.order.invoice.paid ? 'paid' : 'pending')) }
    <img src="/public/assets/images/vendor/cards.svg" class="float-right" />
  </a>

  <script>
    // do mixins
    this.mixin ('i18n');

  </script>
</stripe-payment>
