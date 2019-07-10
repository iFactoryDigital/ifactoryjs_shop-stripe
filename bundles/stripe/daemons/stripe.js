
// require daemon
const config = require('config');
const Daemon = require('daemon');
const stripe = require('stripe');

/**
 * Stripe Daemon
 *
 * @extends Daemon
 */
class StripeDaemon extends Daemon {
  /**
   * construct stripe daemon
   */
  constructor(...args) {
    // run super
    super(...args);

    // Set private variables
    this._stripe = stripe(config.get('stripe.secret'));

    // bind methods
    this.cancelEndpoint = this.cancelEndpoint.bind(this);
    this.updateEndpoint = this.updateEndpoint.bind(this);
  }

  // ////////////////////////////////////////////////////////////////////////////
  //
  // ENDPOINTS
  //
  // ////////////////////////////////////////////////////////////////////////////

  /**
   * cancel endpoint
   *
   * @param  {Subscription} subscription
   *
   * @return   {Promise}
   * @endpoint subscription.stripe.cancel
   */
  async cancelEndpoint(subscription) {
    // check charge
    if (!subscription.get('charge.id')) return;

    // cancel subscription
    subscription.set('cancel', await this._stripe.subscriptions.update(subscription.get('charge.id'), {
      cancel_at_period_end : true,
    }));

    // set state
    subscription.set('state', 'cancelled');
    subscription.set('cancel_at', new Date());

    // save subscription
    await subscription.save();
  }

  /**
   * update endpoint
   *
   * @param  {Subscription} subscription
   *
   * @return   {Promise}
   * @endpoint subscription.stripe.update
   */
  async updateEndpoint(subscription) {
    // check charge
    if (!subscription.get('charge.id')) return;

    // cancel subscription
    const agreement = await this._stripe.subscriptions.retrieve(subscription.get('charge.id'));

    // check active
    if (agreement.status !== 'active' || agreement.cancel_at_period_end) {
      // set cancel
      subscription.set('cancel', agreement);

      // set state
      subscription.set('state', 'cancelled');
      subscription.set('cancel_at', new Date());

      // save subscription
      await subscription.save();
    }
  }
}

/**
 * export stripe daemon
 *
 * @type {*}
 */
module.exports = StripeDaemon;
