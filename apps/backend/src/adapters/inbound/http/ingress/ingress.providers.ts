import type { Provider } from "@nestjs/common";
import {
  INGRESS_KEY_COMPARER,
  TimingSafeIngressKeyComparer,
} from "./ingress-key-comparer";

/** Binds the ingress credential check used by `IngressGuard`. */
export const ingressGuardProviders: Provider[] = [
  {
    provide: INGRESS_KEY_COMPARER,
    useFactory: (): TimingSafeIngressKeyComparer =>
      new TimingSafeIngressKeyComparer(process.env.BOS_INGRESS_KEY),
  },
];
