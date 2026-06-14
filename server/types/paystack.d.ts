declare module '@paystack/paystack-sdk' {
  export interface PaystackResponse<T = any> {
    status: boolean;
    message: string;
    data?: T;
    meta?: any;
  }

  export interface PlanCreateParams {
    name: string;
    interval: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'annually';
    amount: string;
    currency?: string;
    description?: string;
    send_invoices?: boolean;
    send_sms?: boolean;
    invoice_limit?: number;
  }

  export interface TransactionInitParams {
    email: string;
    amount: string;
    currency?: string;
    reference?: string;
    callback_url?: string;
    metadata?: Record<string, any>;
    plan?: string;
    channels?: string[];
  }

  export interface SubscriptionCreateParams {
    customer: string;
    plan: string;
    start_date?: string;
  }

  export interface SubscriptionToggleParams {
    code: string;
    token: string;
  }

  export interface CustomerCreateParams {
    email: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
  }

  export interface ListParams {
    perPage?: number;
    page?: number;
    [key: string]: any;
  }

  export default class Paystack {
    constructor(secretKey: string);

    transaction: {
      initialize(params: TransactionInitParams): Promise<PaystackResponse>;
      verify(reference: string): Promise<PaystackResponse>;
      list(params: ListParams): Promise<PaystackResponse>;
      fetch(id: number): Promise<PaystackResponse>;
    };

    plan: {
      create(params: PlanCreateParams): Promise<PaystackResponse>;
      list(params: ListParams): Promise<PaystackResponse>;
      fetch(idOrCode: string): Promise<PaystackResponse>;
      update(idOrCode: string, params: Partial<PlanCreateParams>): Promise<PaystackResponse>;
    };

    subscription: {
      create(params: SubscriptionCreateParams): Promise<PaystackResponse>;
      list(params: ListParams): Promise<PaystackResponse>;
      fetch(idOrCode: string): Promise<PaystackResponse>;
      enable(params: SubscriptionToggleParams): Promise<PaystackResponse>;
      disable(params: SubscriptionToggleParams): Promise<PaystackResponse>;
    };

    customer: {
      create(params: CustomerCreateParams): Promise<PaystackResponse>;
      list(params: ListParams): Promise<PaystackResponse>;
      fetch(emailOrCode: string): Promise<PaystackResponse>;
      update(code: string, params: Partial<CustomerCreateParams>): Promise<PaystackResponse>;
    };
  }
}
