// Require dependencies
const uuid       = require('uuid');
const money      = require('money-math');
const config     = require('config');
const stripe     = require('stripe');
const Controller = require('controller');

// Require models
const Data    = model('stripe');
const Product = model('product');
const Invoice = model('invoice');

/**
 * Create Stripe Controller class
 *
 * @extends Controller
 */
class StripeController extends Controller {
  /**
   * Construct Stripe Controller class
   */
  constructor() {
    // Run super
    super();

    // Set private variables
    this._stripe = stripe(config.get('stripe.secret'));

    // bind methods
    this.payHook = this.payHook.bind(this);
    this.viewHook = this.viewHook.bind(this);
    this.methodHook = this.methodHook.bind(this);
    this.orderHook = this.orderHook.bind(this);
    this.checkoutHook = this.checkoutHook.bind(this);

    // Bind private methods
    this._middleware = this._middleware.bind(this);
    this._createSource = this._createSource.bind(this);

    // Use middleware
    this.eden.router.use(this._middleware);
  }


  // ////////////////////////////////////////////////////////////////////////////
  //
  // HOOK METHODS
  //
  // ////////////////////////////////////////////////////////////////////////////

  /**
   * Checkout order
   *
   * @param {Object} order
   *
   * @pre view.compile
   */
  viewHook(render) {
    // Set config
    render.config.stripe = config.get('stripe.client');
  }

  /**
   * Checkout order
   *
   * @param {Object} order
   *
   * @pre checkout.init
   */
  checkoutHook(order) {
    // Add action
    order.set('actions.stripe', {
      type     : 'stripe',
      data     : {},
      priority : 10,
    });
  }

  /**
   * Add Payment Method to list
   *
   * @param {Object} order
   * @param {Object} action
   *
   * @pre    payment.init
   * @return {Promise}
   */
  async methodHook(order, action) {
    // Return action check
    if (action.type !== 'payment') return;

    // Load Stripe data for user
    const data = await Data.findOne({
      'user.id' : order.get('user.id'),
    });

    // Add Stripe Payment Method
    action.data.methods.push({
      type     : 'stripe',
      data     : data ? await data.sanitise() : {},
      priority : 0,
    });
  }

  /**
   * on shipping
   *
   * @param  {order}   Order
   * @param  {Object}  action
   *
   * @pre    order.stripe
   * @return {Promise}
   */
  async orderHook(order, action, actions) {
    // set shipping
    const user = await order.get('user');

    // check action value
    if (!action.value || !Object.keys(action.value).length) return;

    // check user
    if (user) {
      // lock user
      await user.lock();

      // set email
      user.set('name', user.get('name') || action.value.payerName);
      user.set('email', user.get('email') || action.value.payerEmail);

      // save user
      await user.save();

      // unlock user
      user.unlock();
    }

    // find payment action
    const paymentAction = actions.find(check => check.type === 'payment');

    // set value
    paymentAction.value = {
      type    : 'stripe',
      data    : action.value.token,
      request : true,
    };

    // set actions
    order.set('actions', actions);
  }

  /**
   * Pay using Payment Method
   *
   * @param {Payment} payment
   *
   * @post   payment.pay
   * @return {Promise}
   */
  async payHook(payment) {
    // Check super
    if (payment.get('method.type') !== 'stripe') return;

    // set source
    let source = null;

    // check if normal payment request api
    if (payment.get('method.request')) {
      // is payment request api
      source = payment.get('method.data.id');
    } else {
      // Set source
      source = await this._createSource(payment);
    }

    // Check source
    if (!source) return;

    // get invoice details
    const invoice       = await payment.get('invoice') || new Invoice();
    const orders        = await invoice.get('orders') || [];
    const subscriptions = [].concat(...(await Promise.all(orders.map(order => order.get('subscriptions'))))).filter(s => s);

    // get lines
    const lines = invoice.get('lines');

    // Get currency
    const currency = payment.get('currency').toLowerCase() || 'usd';

    // Get zero decimal
    const zeroDecimal = ['MGA', 'BIF', 'PYGI', 'XAF', 'XPF', 'CLP', 'KMF', 'RWF', 'DJF', 'KRW', 'GNF', 'JPY', 'VUV', 'VND', 'XOF'];

    // Run try/catch
    try {
      // get real total
      let realTotal = payment.get('amount');

      // get subscriptions
      if (subscriptions && subscriptions.length) {
        // let items
        const subscriptionItems = (await Promise.all(lines.map(async (line) => {
          // get product
          const product = await Product.findById(line.product);

          // return object
          return {
            sku      : line.sku,
            name     : line.title,
            type     : product.get('type'),
            price    : money.floatToAmount(parseFloat(line.price)),
            amount   : money.floatToAmount(parseFloat(line.total)),
            period   : (line.opts || {}).period,
            product  : product.get('_id').toString(),
            discount : line.discount || 0,
            currency : payment.get('currency') || config.get('shop.currency') || 'USD',
            quantity : parseInt(line.qty || 1, 10),
          };
        }))).filter(item => item.type === 'subscription');

        // remove from total
        const subscriptionTotal = parseFloat(subscriptionItems.reduce((accum, item) => {
          // add amount
          return money.add(accum, money.floatToAmount(parseFloat(item.price) * item.quantity));
        }, '0.00'));
        const initialTotal = parseFloat(subscriptionItems.reduce((accum, line) => {
          // return accum
          accum = money.add(accum, money.floatToAmount(parseFloat(line.price) * (line.quantity || 1)));

          // return value
          return money.subtract(accum, money.floatToAmount(line.discount));
        }, '0.00'));

        // remove amount
        realTotal -= initialTotal;

        // set periods
        const periods = {
          weekly : {
            interval       : 'week',
            interval_count : 1,
          },
          monthly : {
            interval       : 'month',
            interval_count : 1,
          },
          quarterly : {
            interval       : 'month',
            interval_count : 3,
          },
          biannually : {
            interval       : 'month',
            interval_count : 6,
          },
          annually : {
            interval       : 'year',
            interval_count : 1,
          },
        };

        // loop subscriptions
        await Promise.all(subscriptions.map(async (subscription) => {
          // find item
          const item = subscriptionItems.find(i => i.product = subscription.get('product.id') && i.period === subscription.get('period'));

          // create plan
          const plan = await this._stripe.plans.create({
            amount  : (zeroDecimal.includes(currency.toUpperCase()) ? parseInt(item.price, 10) : parseInt(parseFloat(item.price) * 100, 10)).toFixed(0),
            product : {
              name : `Subscription #${subscription.get('_id').toString()}`,
            },
            interval       : periods[item.period].interval,
            currency       : item.currency,
            interval_count : periods[item.period].interval_count,
          });

          // set stripe
          subscription.set('plan', plan);
        }));

        // check data
        const subData = {
          items : subscriptions.map((subscription) => {
            return {
              plan : subscription.get('plan.id'),
            };
          }),
          customer : source.customer,
        };

        // set trial
        if (invoice.get('trial')) {
          // set trial end
          subData.trial_end = parseInt((new Date(invoice.get('trial'))).getTime() / 1000, 10);
        }

        // check total
        if (initialTotal < subscriptionTotal) {
          // create coupon
          const coupon = await this._stripe.coupons.create({
            currency,
            id         : uuid(),
            duration   : 'once',
            amount_off : ((subscriptionTotal - initialTotal) * 100).toFixed(0),
          });

          // discounted
          subData.coupon = coupon.id;
        }

        // create actual subscription
        const charge = await this._stripe.subscriptions.create(subData);

        // loop subscriptions
        await Promise.all(subscriptions.map(async (subscription) => {
          // set paypal
          subscription.set('charge', charge);

          // save subscription
          await subscription.save();
        }));
      }

      // check amount
      if (!realTotal || realTotal < 0) {
        // Set complete
        payment.set('complete', true);

        // return
        return;
      }

      // create data
      const data = {
        currency,
        amount      : (zeroDecimal.indexOf(currency.toUpperCase()) > -1 ? realTotal : (realTotal * 100)).toFixed(0),
        description : `Payment ID ${payment.get('_id').toString()}`,
      };

      // check data
      if (payment.get('method.request')) {
        // set source
        data.source = source;
      } else {
        // set card data
        data.source = source.source;
        data.customer = source.customer;
      }

      // Create chargs
      const charge = await this._stripe.charges.create(data);

      // Set charge
      payment.set('data', {
        charge,
      });

      // Set complete
      payment.set('complete', true);
    } catch (e) {
      // Set error
      payment.set('error', {
        id   : 'stipe.error',
        text : e.toString(),
      });

      // Set not complete
      payment.set('complete', false);
    }
  }


  // ////////////////////////////////////////////////////////////////////////////
  //
  // PRIVATE METHODS
  //
  // ////////////////////////////////////////////////////////////////////////////

  /**
   * stripe middleware
   *
   * @param {req} req
   * @param {res} res
   * @param {Function} next
   */
  _middleware(req, res, next) {
    // set footer
    const ft = '<script src="//js.stripe.com/v3/"></script>';

    // set head
    res.locals.page.script = (res.locals.page.script || '') + ft;

    // run next
    next();
  }

  /**
   * Create source based on a given payment
   *
   * @param  {Payment} payment
   *
   * @return {Promise<Data|boolean>}
   *
   * @private
   */
  async _createSource(payment) {
    // Set method
    const method = payment.get('method.data');

    // Set user
    const user = await payment.get('user');

    // Set data
    let data = user && await Data.findOne({
      'user.id' : user.get('_id').toString(),
    });

    // Check card id
    if (method.card.id) {
      // Check user
      if (!user) {
        // Set error
        payment.set('error', {
          id   : 'stipe.nouser',
          text : 'Invalid user',
        });

        // Return false
        return false;
      }

      const card = data && (data.get('cards') || []).find((card) => {
        // Return card id check
        return card.id = method.card.id;
      });

      // Check data
      if (!card) {
        // Set error
        payment.set('error', {
          id   : 'stipe.notfound',
          text : 'Credit card not found',
        });

        // Return false
        return false;
      }

      // Return source
      return {
        source   : card.source,
        customer : data.get('customer'),
      };
    }

    // Try/catch
    try {
      // Set customer
      const customer = data ? data.get('customer') : (await this._stripe.customers.create({
        email : user ? user.get('email') : 'anonymous',
      })).id;

      // Check data and save
      if (user && !data && method.save) {
        // Create new data
        data = new Data({
          user,
          customer,
        });
      }

      // Set req
      const req = method.card;

      // Create card
      const card = await this._stripe.customers.createSource(customer, {
        source : {
          cvc       : req.cvc,
          name      : req.name,
          number    : req.number,
          object    : 'card',
          exp_year  : req.expiry.year,
          exp_month : req.expiry.month,
        },
      });

      // Check save
      if (method.save && data) {
        // Set cards
        const cards = data.get('cards') || [];

        // Push new card to cards
        cards.push({
          id      : uuid(),
          brand   : card.brand.toLowerCase(),
          last4   : card.last4,
          source  : card.id,
          funding : card.funding,
          country : card.country,
        });

        // Update data
        data.set('cards', cards);

        // Save data
        await data.save();
      }

      // Return source
      return {
        source   : card.id,
        customer,
      };
    } catch (e) {
      // Set error
      payment.set('error', {
        id   : 'stipe.error',
        text : e.toString(),
      });

      // Return false
      return false;
    }
  }
}

/**
 * Export Stripe Controller class
 *
 * @type {StripeController}
 */
exports = module.exports = StripeController;
