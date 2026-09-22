import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { IndexCandlestickChart, parseIndexPrice } from "./IndexCandlestickChart";

afterEach(cleanup);

it("marks intraday extremes rather than closing extremes and supports selection", () => {
  render(<IndexCandlestickChart title="KOSPI" rows={[
    { date: "20260921", open: 100, high: 120, low: 90, close: 105 },
    { date: "20260918", open: 109, high: 115, low: 95, close: 110 },
  ]} />);
  expect(screen.getByText("최고 120.00")).toBeInTheDocument();
  expect(screen.getByText("최저 90.00")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /09.18 시가/ }));
  expect(screen.getByRole("tooltip")).toHaveTextContent("109.00");
  fireEvent.mouseLeave(screen.getByRole("button", { name: /09.18 시가/ }));
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  fireEvent.mouseEnter(screen.getByRole("button", { name: /09.21 시가/ }));
  expect(screen.getByRole("tooltip")).toHaveTextContent("09.21");
  fireEvent.mouseLeave(screen.getByRole("button", { name: /09.21 시가/ }));
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
});

it("does not invent OHLC from missing values and handles flat prices", () => {
  expect(parseIndexPrice("-")).toBeNull();
  expect(parseIndexPrice("0")).toBeNull();
  expect(parseIndexPrice("7,000.25")).toBe(7000.25);
  const { container } = render(<IndexCandlestickChart title="KOSPI" rows={[
    { date: "20260921", open: null, high: null, low: null, close: 100 },
  ]} />);
  expect(screen.getByText(/일부 일자는/)).toBeInTheDocument();
  expect(screen.queryByText(/^최고 /)).toBeNull();
  expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
});
