<stripe-payment>
  <a href="#!">
    <img src="/public/assets/images/vendor/stripe.svg" class="float-right stripe-logo" />
    <i class="fa fa-times text-danger mr-3" if={ !opts.payment.complete } />
    <i class="fa fa-check text-success mr-3" if={ opts.payment.complete } />
    { this.t('stripe.order.' + (opts.payment.complete ? 'paid' : 'failed')) }
  </a>

  <script>
    // do mixins
    this.mixin('i18n');

  </script>
</stripe-payment>
