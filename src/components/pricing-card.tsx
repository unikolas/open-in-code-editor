import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type PricingCardProps = {
  name: string
  price: string
  description: string
  features: string[]
  highlighted?: boolean
}

export function PricingCard({
  name,
  price,
  description,
  features,
  highlighted,
}: PricingCardProps) {
  return (
    <Card className="w-full max-w-xs">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{name}</CardTitle>
          {highlighted && <Badge>Popular</Badge>}
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-3xl font-semibold">
          {price}
          <span className="text-sm font-normal text-muted-foreground">
            /month
          </span>
        </p>
        <ul className="space-y-2 text-sm text-muted-foreground">
          {features.map((feature) => (
            <li key={feature} className="flex items-center gap-2">
              <span aria-hidden className="text-primary">
                ✓
              </span>
              {feature}
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter>
        <Button className="w-full" variant={highlighted ? "default" : "outline"}>
          Get started
        </Button>
      </CardFooter>
    </Card>
  )
}
