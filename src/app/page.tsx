import { Counter } from "@/components/counter"
import { PricingCard } from "@/components/pricing-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-16 px-6 py-16">
      <section className="flex flex-col items-start gap-4">
        <Badge variant="secondary">Inspector demo</Badge>
        <h1 className="text-4xl font-semibold tracking-tight">
          Click-to-source playground
        </h1>
        <p className="max-w-prose text-muted-foreground">
          Hold <kbd className="rounded border px-1.5 py-0.5 text-xs">⌥</kbd> to
          highlight any element, then click to open its source in your editor.
        </p>
        <div className="flex gap-3">
          <Button>Primary action</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
        </div>
        <Counter />
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-2xl font-semibold tracking-tight">Pricing</h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <PricingCard
            name="Hobby"
            price="$0"
            description="For side projects and experiments."
            features={["1 project", "Community support", "Basic analytics"]}
          />
          <PricingCard
            name="Pro"
            price="$12"
            description="For serious builders shipping weekly."
            features={["Unlimited projects", "Priority support", "Advanced analytics"]}
            highlighted
          />
          <PricingCard
            name="Team"
            price="$29"
            description="For teams collaborating on products."
            features={["Everything in Pro", "Shared workspaces", "SSO"]}
          />
        </div>
      </section>

      <section className="flex max-w-sm flex-col gap-4">
        <h2 className="text-2xl font-semibold tracking-tight">Stay updated</h2>
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" placeholder="you@example.com" />
        </div>
        <Button className="self-start">Subscribe</Button>
      </section>
    </main>
  )
}
