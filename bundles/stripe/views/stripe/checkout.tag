<stripe-checkout>
  <div if={ this.can } class="mb-4">
    <button class="btn btn-block btn-lg btn-primary" onclick={ onClick }>
      Pay Now
    </button>
  </div>

  <script>
    // do mixins
    this.mixin('i18n');
    this.mixin('user');
    this.mixin('config');

    // set variables
    this.loading = false;
    
    /**
     * on click
     *
     * @param {Event} e
     */
    onClick(e) {
      // prevent default
      e.preventDefault();
      e.stopPropagation();
      
      // show payment request
      this.request.show();
    }

    /**
     * on remove removes code
     */
    this.on('mount', async () => {
      // set validate to value
      if (!opts.action.value) opts.action.value = {};

      // check frontend
      if (!this.eden.frontend) return;

      // build stripe
      this.stripe  = Stripe(this.config.stripe);
      this.request = this.stripe.paymentRequest({
        'country'  : 'US',
        'currency' : (this.eden.get('shop.currency') || 'USD').toLowerCase(),
        'total' : {
          'label'  : 'GM8 order',
          'amount' : (await opts.checkout.total() * 100),
        },
        'requestPayerName'  : true,
        'requestPayerEmail' : true,
      });

      // await can make payment
      const result = await this.request.canMakePayment();

      // check result
      if (!result) return;
    
      // set can
      this.can = true;

      // update view
      this.update();

      // on token
      const ev = await new Promise((resolve) => this.request.on('token', resolve));
      
      // submit checkout
      opts.action.value = Object.assign({}, ev);

      // remove complete
      delete opts.action.value.complete;

      // submit
      const order = opts.checkout.submit();

      // check paid
      if ((order.invoice || {}).paid) {
        // complete success
        ev.complete('success');
      } else {
        ev.complete('fail');
      }
    });

  </script>
</stripe-checkout>
